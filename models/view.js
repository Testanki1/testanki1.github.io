import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
const A3D_SIGNATURE_BYTES = new Uint8Array([0x41, 0x33, 0x44, 0x00]); // "A3D\0"
const A3D_ROOTBLOCK_SIGNATURE = 1;
const A3D_MATERIALBLOCK_SIGNATURE = 4;
const A3D_MESHBLOCK_SIGNATURE = 2;
const A3D_TRANSFORMBLOCK_SIGNATURE = 3;
const A3D_OBJECTBLOCK_SIGNATURE = 5;

const A3D_VERTEXTYPE_COORDINATE = 1;
const A3D_VERTEXTYPE_UV1 = 2;
const A3D_VERTEXTYPE_NORMAL1 = 3;
const A3D_VERTEXTYPE_UV2 = 4; // Not fully handled in this basic viewer
const A3D_VERTEXTYPE_COLOR = 5; // Not fully handled
const A3D_VERTEXTYPE_NORMAL2 = 6; // Not fully handled

const A3DVertexSize = {
    [A3D_VERTEXTYPE_COORDINATE]: 3,
    [A3D_VERTEXTYPE_UV1]: 2,
    [A3D_VERTEXTYPE_NORMAL1]: 3,
    [A3D_VERTEXTYPE_UV2]: 2,
    [A3D_VERTEXTYPE_COLOR]: 4,
    [A3D_VERTEXTYPE_NORMAL2]: 3
};

// --- DOM Elements ---
const a3dFileInput = document.getElementById('a3dFileInput');
const textureFilesInput = document.getElementById('textureFilesInput');
const statusElement = document.getElementById('status');
const progressBar = document.getElementById('progressBar');
const infoContainer = document.getElementById('info');

// --- Three.js Scene Setup ---
let scene, camera, renderer, controls;
let loadedObject = null;
const textureCache = new Map(); // To store loaded textures

function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x505050);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
    camera.position.set(100, 100, 100); // Default camera position

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);

    window.addEventListener('resize', onWindowResize, false);
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// --- Binary Stream Reader ---
class Stream {
    constructor(arrayBuffer) {
        this.dataView = new DataView(arrayBuffer);
        this.offset = 0;
    }

    readBytes(length) {
        const bytes = new Uint8Array(this.dataView.buffer, this.offset, length);
        this.offset += length;
        return bytes;
    }

    readUint8() {
        const val = this.dataView.getUint8(this.offset);
        this.offset += 1;
        return val;
    }

    readUint16LE() {
        const val = this.dataView.getUint16(this.offset, true);
        this.offset += 2;
        return val;
    }

    readInt16LE() {
        const val = this.dataView.getInt16(this.offset, true);
        this.offset += 2;
        return val;
    }
    
    readUint32LE() {
        const val = this.dataView.getUint32(this.offset, true);
        this.offset += 4;
        return val;
    }

    readInt32LE() {
        const val = this.dataView.getInt32(this.offset, true);
        this.offset += 4;
        return val;
    }

    readFloat32LE() {
        const val = this.dataView.getFloat32(this.offset, true);
        this.offset += 4;
        return val;
    }

    readNullTerminatedString() {
        let str = "";
        let charCode;
        while ((charCode = this.readUint8()) !== 0x00) {
            str += String.fromCharCode(charCode);
        }
        return str;
    }

    readLengthPrefixedString() {
        const length = this.readUint32LE();
        const strBytes = this.readBytes(length);
        const paddingSize = ((length + 3) >> 2) * 4 - length;
        if (paddingSize > 0) this.readBytes(paddingSize);
        return new TextDecoder().decode(strBytes);
    }

    calculatePadding(length) {
        return (((length + 3) >> 2) * 4) - length;
    }

    skipPadding(length) {
        const padding = this.calculatePadding(length);
        if (padding > 0) this.readBytes(padding);
    }
}

// --- A3D Parser ---
class A3DParser {
    constructor(stream) {
        this.stream = stream;
        this.version = 0;
        this.materials = [];
        this.meshes = [];
        this.transforms = [];
        this.transformParentIDs = [];
        this.objects = [];
    }

    parse() {
        console.log("Starting A3D parse...");
        const signature = this.stream.readBytes(4);
        if (!signature.every((val, index) => val === A3D_SIGNATURE_BYTES[index])) {
            throw new Error("Invalid A3D signature.");
        }

        this.version = this.stream.readUint16LE();
        this.stream.readUint16LE(); // Minor version, unused
        console.log(`A3D Version: ${this.version}`);

        if (this.version === 1) throw new Error("Version 1 A3D files are not supported.");
        if (this.version === 2) this.readRootBlock2();
        else if (this.version === 3) this.readRootBlock3();
        else throw new Error(`Unsupported A3D version: ${this.version}`);
        
        console.log("A3D Parsing complete.");
        return this;
    }

    readRootBlock2() {
        const signature = this.stream.readUint32LE();
        this.stream.readUint32LE(); // Length, unused for v2 root
        if (signature !== A3D_ROOTBLOCK_SIGNATURE) throw new Error("Invalid v2 root block signature.");
        
        this.readMaterialBlock2();
        this.readMeshBlock2();
        this.readTransformBlock2();
        this.readObjectBlock2();
    }

    readRootBlock3() {
        const signature = this.stream.readUint32LE();
        const length = this.stream.readUint32LE();
        if (signature !== A3D_ROOTBLOCK_SIGNATURE) throw new Error("Invalid v3 root block signature.");
        const startOffset = this.stream.offset;

        this.readMaterialBlock3();
        this.readMeshBlock3();
        this.readTransformBlock3();
        this.readObjectBlock3();
        
        const bytesRead = this.stream.offset - startOffset;
        const padding = length - bytesRead; // Correct padding calculation for v3 root block
        if (padding > 0) this.stream.readBytes(padding);
    }

    // Material Blocks
    _readMaterialBlock(version) {
        const signature = this.stream.readUint32LE();
        const length = (version === 3) ? this.stream.readUint32LE() : this.stream.readUint32LE(); // v2 also has a length field here, usually 0
        const materialCount = this.stream.readUint32LE();
        if (signature !== A3D_MATERIALBLOCK_SIGNATURE) throw new Error("Invalid material block signature.");
        console.log(`Reading ${materialCount} materials (version ${version})`);

        const startOffset = this.stream.offset;
        for (let i = 0; i < materialCount; i++) {
            const material = {};
            if (version === 2) {
                material.name = this.stream.readNullTerminatedString();
                material.color = [this.stream.readFloat32LE(), this.stream.readFloat32LE(), this.stream.readFloat32LE()];
                material.diffuseMap = this.stream.readNullTerminatedString();
            } else { // version 3
                material.name = this.stream.readLengthPrefixedString();
                material.color = [this.stream.readFloat32LE(), this.stream.readFloat32LE(), this.stream.readFloat32LE()];
                material.diffuseMap = this.stream.readLengthPrefixedString();
            }
            this.materials.push(material);
            console.log(`  Material ${i}: ${material.name}, Color: ${material.color}, Map: ${material.diffuseMap}`);
        }
        if (version === 3) {
            const bytesRead = this.stream.offset - startOffset;
            this.stream.skipPadding(bytesRead); // Padding is based on content length, not block length for sub-blocks
        }
    }
    readMaterialBlock2() { this._readMaterialBlock(2); }
    readMaterialBlock3() { this._readMaterialBlock(3); }

    // Mesh Blocks
    _readMeshBlock(version) {
        const signature = this.stream.readUint32LE();
        const length = (version === 3) ? this.stream.readUint32LE() : this.stream.readUint32LE();
        const meshCount = this.stream.readUint32LE();
        if (signature !== A3D_MESHBLOCK_SIGNATURE) throw new Error("Invalid mesh block signature.");
        console.log(`Reading ${meshCount} meshes (version ${version})`);

        const startOffset = this.stream.offset;
        for (let i = 0; i < meshCount; i++) {
            const meshData = { vertexBuffers: [], submeshes: [] };
            if (version === 3) {
                meshData.name = this.stream.readLengthPrefixedString();
                meshData.bboxMax = [this.stream.readFloat32LE(), this.stream.readFloat32LE(), this.stream.readFloat32LE()];
                meshData.bboxMin = [this.stream.readFloat32LE(), this.stream.readFloat32LE(), this.stream.readFloat32LE()];
                this.stream.readFloat32LE(); // Unknown float
            } else {
                meshData.name = `Mesh_${i}`; // V2 meshes don't have names in the mesh block
            }

            meshData.vertexCount = this.stream.readUint32LE();
            const vertexBufferCount = this.stream.readUint32LE();
            for (let j = 0; j < vertexBufferCount; j++) {
                const vb = { data: [] };
                vb.bufferType = this.stream.readUint32LE();
                if (!A3DVertexSize[vb.bufferType]) throw new Error(`Unknown vertex buffer type: ${vb.bufferType}`);
                const vertexSize = A3DVertexSize[vb.bufferType];
                for (let k = 0; k < meshData.vertexCount; k++) {
                    const vertex = [];
                    for (let l = 0; l < vertexSize; l++) vertex.push(this.stream.readFloat32LE());
                    vb.data.push(vertex);
                }
                meshData.vertexBuffers.push(vb);
            }

            const submeshCount = this.stream.readUint32LE();
            for (let j = 0; j < submeshCount; j++) {
                const submesh = { indices: [] };
                if (version === 2) {
                    let indexCount = this.stream.readUint32LE() * 3;
                    for (let k = 0; k < indexCount; k++) submesh.indices.push(this.stream.readUint16LE());
                    submesh.smoothingGroups = []; // Not used in this basic viewer
                    for (let k = 0; k < indexCount / 3; k++) submesh.smoothingGroups.push(this.stream.readUint32LE());
                    submesh.materialID = this.stream.readUint16LE();
                } else { // version 3
                    const indexCount = this.stream.readUint32LE();
                    const indicesStartOffset = this.stream.offset;
                    for (let k = 0; k < indexCount; k++) submesh.indices.push(this.stream.readUint16LE());
                    this.stream.skipPadding(indexCount * 2); // Each index is 2 bytes
                    submesh.materialID = null; // V3 stores material IDs in Object block
                }
                meshData.submeshes.push(submesh);
            }
            this.meshes.push(meshData);
            console.log(`  Mesh ${i}: ${meshData.name}, Verts: ${meshData.vertexCount}, Submeshes: ${meshData.submeshes.length}`);
        }
         if (version === 3) {
            const bytesRead = this.stream.offset - startOffset;
            this.stream.skipPadding(bytesRead);
        }
    }
    readMeshBlock2() { this._readMeshBlock(2); }
    readMeshBlock3() { this._readMeshBlock(3); }

    // Transform Blocks
    _readTransformBlock(version) {
        const signature = this.stream.readUint32LE();
        const length = (version === 3) ? this.stream.readUint32LE() : this.stream.readUint32LE();
        const transformCount = this.stream.readUint32LE();
        if (signature !== A3D_TRANSFORMBLOCK_SIGNATURE) throw new Error("Invalid transform block signature.");
        console.log(`Reading ${transformCount} transforms (version ${version})`);

        const startOffset = this.stream.offset;
        for (let i = 0; i < transformCount; i++) {
            const transform = {};
            if (version === 3) transform.name = this.stream.readLengthPrefixedString();
            else transform.name = `Transform_${i}`;
            transform.position = [this.stream.readFloat32LE(), this.stream.readFloat32LE(), this.stream.readFloat32LE()];
            transform.rotation = [this.stream.readFloat32LE(), this.stream.readFloat32LE(), this.stream.readFloat32LE(), this.stream.readFloat32LE()]; // x, y, z, w
            transform.scale = [this.stream.readFloat32LE(), this.stream.readFloat32LE(), this.stream.readFloat32LE()];
            this.transforms.push(transform);
        }
        for (let i = 0; i < transformCount; i++) {
            this.transformParentIDs.push(this.stream.readInt32LE()); // Signed int for parent ID
        }
        if (version === 3) {
            const bytesRead = this.stream.offset - startOffset;
            this.stream.skipPadding(bytesRead);
        }
    }
    readTransformBlock2() { this._readTransformBlock(2); }
    readTransformBlock3() { this._readTransformBlock(3); }
    
    // Object Blocks
    _readObjectBlock(version) {
        const signature = this.stream.readUint32LE();
        const length = (version === 3) ? this.stream.readUint32LE() : this.stream.readUint32LE();
        const objectCount = this.stream.readUint32LE();
        if (signature !== A3D_OBJECTBLOCK_SIGNATURE) throw new Error("Invalid object block signature.");
        console.log(`Reading ${objectCount} objects (version ${version})`);
        
        const startOffset = this.stream.offset;
        for (let i = 0; i < objectCount; i++) {
            const obj = {};
            if (version === 2) {
                obj.name = this.stream.readNullTerminatedString();
                obj.meshID = this.stream.readUint32LE();
                obj.transformID = this.stream.readUint32LE();
                obj.materialIDs = []; // V2 uses materialID from submesh
            } else { // version 3
                obj.meshID = this.stream.readUint32LE();
                obj.transformID = this.stream.readUint32LE();
                const materialCount = this.stream.readUint32LE();
                obj.materialIDs = [];
                for (let j = 0; j < materialCount; j++) {
                    obj.materialIDs.push(this.stream.readInt32LE()); // Signed int for material ID (-1 means no material)
                }
                obj.name = this.transforms[obj.transformID]?.name || `Object_${i}`; // V3 obj name often from transform
            }
            this.objects.push(obj);
            console.log(`  Object ${i}: ${obj.name}, MeshID: ${obj.meshID}, TransformID: ${obj.transformID}`);
        }
        if (version === 3) {
            const bytesRead = this.stream.offset - startOffset;
            this.stream.skipPadding(bytesRead);
        }
    }
    readObjectBlock2() { this._readObjectBlock(2); }
    readObjectBlock3() { this._readObjectBlock(3); }
}


// --- Create Three.js Meshes from Parsed Data ---
function createThreeJSObjects(parsedA3D) {
    const group = new THREE.Group();
    const threeObjects = []; // To store top-level objects for parenting

    // Create placeholder materials
    const threeMaterials = parsedA3D.materials.map((matData, index) => {
        const params = {
            name: matData.name,
            color: new THREE.Color().fromArray(matData.color),
            side: THREE.DoubleSide // Common for game models
        };
        
        if (matData.diffuseMap && matData.diffuseMap.trim() !== "") {
            const texture = textureCache.get(matData.diffuseMap.toLowerCase());
            if (texture) {
                params.map = texture;
                 // Mirror UV Y coordinate for diffuseMap textures (common in A3D)
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.set(1, -1); 
            } else {
                console.warn(`Texture "${matData.diffuseMap}" not found in cache.`);
            }
        }
        return new THREE.MeshStandardMaterial(params);
    });

    // Create objects
    parsedA3D.objects.forEach((objData, objIndex) => {
        const meshData = parsedA3D.meshes[objData.meshID];
        const transformData = parsedA3D.transforms[objData.transformID];

        if (!meshData || !transformData) {
            console.warn(`Skipping object ${objIndex} due to missing mesh/transform data.`);
            return;
        }

        const geometry = new THREE.BufferGeometry();
        let positions = [];
        let normals = [];
        let uvs = [];

        meshData.vertexBuffers.forEach(vb => {
            if (vb.bufferType === A3D_VERTEXTYPE_COORDINATE) {
                positions = vb.data.flat();
            } else if (vb.bufferType === A3D_VERTEXTYPE_NORMAL1) {
                normals = vb.data.flat();
            } else if (vb.bufferType === A3D_VERTEXTYPE_UV1) {
                // A3D UVs often have Y flipped or need 1-Y.
                // We will handle Y-flip on texture.repeat.y = -1 if necessary,
                // or do it here:
                uvs = vb.data.map(uvPair => [uvPair[0], 1.0 - uvPair[1]]).flat();
                // uvs = vb.data.flat(); 
            }
        });

        if (positions.length > 0) geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (normals.length > 0) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        else if (positions.length > 0) geometry.computeVertexNormals(); // Compute if not provided
        
        if (uvs.length > 0) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        const objectMaterials = [];
        let hasSubmeshesWithMaterials = false;

        if (meshData.submeshes.length > 0) {
            let currentBaseIndex = 0;
            meshData.submeshes.forEach((submesh, submeshIndex) => {
                geometry.setIndex(submesh.indices); // This is simplified; true multi-submesh needs careful indexing.
                                                     // For now, we assume submeshes define material groups for the whole mesh.

                let materialIndex = -1;
                if (parsedA3D.version === 2) {
                    materialIndex = submesh.materialID;
                } else { // version 3
                    // V3 objects reference materials directly, submeshes don't have IDs.
                    // We need to find the material for this submesh from objData.materialIDs
                    // This is a simplification: assuming one material per object for V3 if submeshes exist,
                    // or if objData.materialIDs has one entry. If multiple, it gets complex.
                    if (objData.materialIDs && objData.materialIDs.length > submeshIndex) {
                         materialIndex = objData.materialIDs[submeshIndex]; // Or objData.materialIDs[0] if only one
                    } else if (objData.materialIDs && objData.materialIDs.length > 0) {
                        materialIndex = objData.materialIDs[0];
                    }
                }
                
                if (materialIndex !== -1 && materialIndex < threeMaterials.length) {
                    objectMaterials.push(threeMaterials[materialIndex]);
                    geometry.addGroup(currentBaseIndex, submesh.indices.length, objectMaterials.length - 1);
                    hasSubmeshesWithMaterials = true;
                } else if (materialIndex !== -1) {
                     console.warn(`Material ID ${materialIndex} out of bounds for submesh.`);
                }
                currentBaseIndex += submesh.indices.length; // This is not quite right for addGroup if indices are global
            });
             // Re-set index if submeshes were processed
            const allIndices = meshData.submeshes.map(sm => sm.indices).flat();
            if (allIndices.length > 0) geometry.setIndex(allIndices);

        }

        let finalMaterial;
        if (hasSubmeshesWithMaterials) {
            finalMaterial = objectMaterials; // Array of materials
        } else if (objData.materialIDs && objData.materialIDs.length > 0 && objData.materialIDs[0] !== -1 && objData.materialIDs[0] < threeMaterials.length) {
            finalMaterial = threeMaterials[objData.materialIDs[0]]; // V3 object-level material
        } else if (threeMaterials.length > 0) {
            finalMaterial = threeMaterials[0]; // Fallback
        } else {
            finalMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide }); // Default if no materials
        }


        const mesh = new THREE.Mesh(geometry, finalMaterial);
        mesh.name = objData.name || meshData.name || `Object_${objIndex}`;

        mesh.position.fromArray(transformData.position);
        mesh.quaternion.fromArray(transformData.rotation); // THREE.Quaternion takes (x, y, z, w)
        mesh.scale.fromArray(transformData.scale);

        threeObjects[objIndex] = mesh; // Store for parenting
    });

    // Apply parenting
    parsedA3D.transformParentIDs.forEach((parentID, childIndex) => {
        if (threeObjects[childIndex]) { // If child object exists
            const childObject = threeObjects[childIndex];
            let parentObject = null;

            if (parsedA3D.version < 3 && parentID === 0) { // V2 root
                parentObject = group;
            } else if (parentID === -1) { // V3 root
                parentObject = group;
            } else if (parentID >= 0 && parentID < threeObjects.length && threeObjects[parentID]) {
                parentObject = threeObjects[parentID];
            } else {
                parentObject = group; // Fallback to main group
            }
            
            if (parentObject && childObject !== parentObject) { // Ensure not parenting to self
                 // Check if child is already a child of the intended parent or if parent is group
                if (parentObject === group && !group.children.includes(childObject)) {
                    group.add(childObject);
                } else if (parentObject !== group && !parentObject.children.includes(childObject)) {
                    parentObject.add(childObject);
                }
            } else if (parentObject === null) { // If no valid parent found, add to main group
                 if (!group.children.includes(childObject)) {
                    group.add(childObject);
                }
            }
        }
    });
    
    // Add any remaining unparented objects to the group
    threeObjects.forEach(obj => {
        if (obj && !obj.parent) {
            group.add(obj);
        }
    });


    // Calculate bounding box and center camera
    if (group.children.length > 0) {
        const bbox = new THREE.Box3().setFromObject(group);
        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5; // Add some padding

        camera.position.copy(center);
        camera.position.x += cameraZ;
        camera.position.y += cameraZ * 0.5; // Slight angle
        camera.position.z += cameraZ;
        camera.lookAt(center);
        controls.target.copy(center);
    }
    
    return group;
}


// --- File Handling ---
a3dFileInput.addEventListener('change', handleFiles);
textureFilesInput.addEventListener('change', handleFiles); // Allow re-selecting textures

async function handleFiles() {
    const a3dFile = a3dFileInput.files[0];
    const localTextureFiles = Array.from(textureFilesInput.files);

    if (!a3dFile) {
        statusElement.textContent = "Please select an .a3d file.";
        return;
    }

    statusElement.textContent = "Processing...";
    progressBar.style.display = 'block';
    progressBar.value = 0;

    // Clear previous model and texture cache
    if (loadedObject) {
        scene.remove(loadedObject);
        loadedObject.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }
    textureCache.clear();

    try {
        // Load textures first
        if (localTextureFiles.length > 0) {
            statusElement.textContent = `Loading ${localTextureFiles.length} texture(s)...`;
            let texturesLoadedCount = 0;
            const textureLoader = new THREE.TextureLoader();
            
            const promises = localTextureFiles.map(file => {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        textureLoader.load(
                            e.target.result,
                            (texture) => {
                                textureCache.set(file.name.toLowerCase(), texture);
                                texturesLoadedCount++;
                                progressBar.value = (texturesLoadedCount / localTextureFiles.length) * 50; // 50% for textures
                                resolve();
                            },
                            undefined,
                            (err) => {
                                console.error(`Error loading texture ${file.name}:`, err);
                                reject(err);
                            }
                        );
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            });
            await Promise.all(promises);
            statusElement.textContent = "Textures loaded. Reading A3D file...";
        } else {
            statusElement.textContent = "No textures selected. Reading A3D file...";
        }


        // Read A3D file
        const arrayBuffer = await a3dFile.arrayBuffer();
        progressBar.value = 60; // Progress update

        const stream = new Stream(arrayBuffer);
        const parser = new A3DParser(stream);
        const parsedA3D = parser.parse();
        progressBar.value = 80;

        statusElement.textContent = "Creating 3D objects...";
        loadedObject = createThreeJSObjects(parsedA3D);
        scene.add(loadedObject);
        progressBar.value = 100;
        statusElement.textContent = `Loaded ${a3dFile.name} successfully.`;
        infoContainer.style.display = 'none'; // Hide file input on success

    } catch (error) {
        console.error("Error processing A3D file:", error);
        statusElement.textContent = `Error: ${error.message}`;
        progressBar.style.display = 'none';
    }
}

// --- Initialize ---
initThreeJS();
