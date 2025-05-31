// js/main.js
import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { A3D, A3D_VERTEXTYPE_COORDINATE, A3D_VERTEXTYPE_UV1, A3D_VERTEXTYPE_NORMAL1 } from './A3DParser.js';

let scene, camera, renderer, controls;
let modelGroup; // A group to hold all parts of the loaded A3D model
let loadedObjects = []; // To keep track of THREE.Mesh objects for selection/deletion
let selectedObject = null;
let loadedTextures = {}; // { 'textureName.webp': THREE.Texture }

const objectListUI = document.getElementById('objectList');
const deleteButton = document.getElementById('deleteSelectedObject');

function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcccccc);
    scene.fog = new THREE.FogExp2(0xcccccc, 0.002);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / computeViewerHeight(), 0.1, 10000);
    camera.position.set(50, 50, 50);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, computeViewerHeight());
    document.getElementById('viewerContainer').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    // controls.minDistance = 10;
    // controls.maxDistance = 500;
    // controls.maxPolarAngle = Math.PI / 2;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);
    
    // Grid Helper
    const gridHelper = new THREE.GridHelper( 200, 20, 0x000000, 0x000000 );
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    scene.add( gridHelper );


    window.addEventListener('resize', onWindowResize, false);
    renderer.domElement.addEventListener('click', onMouseClick, false);
    renderer.domElement.addEventListener('touchstart', onTouchStart, false); // For mobile selection

    animate();
}

function computeViewerHeight() {
    const controlsHeight = document.getElementById('controls').offsetHeight;
    return window.innerHeight - controlsHeight;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / computeViewerHeight();
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, computeViewerHeight());
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function clearScene() {
    if (modelGroup) {
        scene.remove(modelGroup);
        // Properly dispose of geometries and materials
        modelGroup.traverse(object => {
            if (object.isMesh) {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(mat => mat.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            }
        });
    }
    modelGroup = new THREE.Group();
    scene.add(modelGroup);
    loadedObjects = [];
    selectedObject = null;
    objectListUI.innerHTML = '';
    deleteButton.disabled = true;
    // loadedTextures are kept unless explicitly cleared
}

function handleA3DFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            clearScene();
            const a3dData = new A3D().parse(event.target.result);
            console.log("Parsed A3D Data:", a3dData);
            buildThreeJSModel(a3dData);
        } catch (error) {
            console.error("Error parsing A3D file:", error);
            alert(`Error parsing A3D: ${error.message}`);
        }
    };
    reader.readAsArrayBuffer(file);
}

function handleTextureFiles(files) {
    const textureLoader = new THREE.TextureLoader();
    let texturesToLoad = files.length;

    if (texturesToLoad === 0) return;

    const checkAllLoaded = () => {
        texturesToLoad--;
        if (texturesToLoad === 0) {
            console.log("All new textures processed. Re-applying materials.");
            // This implies you might need to rebuild/update materials on existing objects
            // For simplicity, if a model is already loaded, you might need to re-process its materials
            // Or, if textures are loaded BEFORE the model, buildThreeJSModel will pick them up.
             if (modelGroup && modelGroup.children.length > 0) {
                modelGroup.traverse(child => {
                    if (child.isMesh) {
                        const a3dObj = child.userData.a3dObjectData; // We need to store this
                        const a3dMat = child.userData.a3dMaterialData; // And this
                        
                        if (a3dObj && a3dObj.name) {
                            const objectNameLower = a3dObj.name.toLowerCase();
                            let textureToApply = null;
                            if (objectNameLower.includes("hull") || objectNameLower.includes("turret")) {
                                textureToApply = loadedTextures['lightmap.webp'];
                            } else if (objectNameLower.includes("track")) {
                                textureToApply = loadedTextures['tracks.webp'];
                            } else if (objectNameLower.includes("wheel")) {
                                textureToApply = loadedTextures['wheels.webp'];
                            }

                            if (textureToApply) {
                                 if (Array.isArray(child.material)) {
                                    child.material.forEach(mat => { if(mat.map !== textureToApply) mat.map = textureToApply; mat.needsUpdate = true; });
                                } else {
                                    if(child.material.map !== textureToApply) child.material.map = textureToApply;
                                    child.material.needsUpdate = true;
                                }
                            }
                        } else if (a3dMat && a3dMat.diffuseMap) {
                            const diffuseMapName = a3dMat.diffuseMap.toLowerCase().split(/[\\/]/).pop();
                             if (loadedTextures[diffuseMapName]) {
                                if (Array.isArray(child.material)) {
                                     child.material.forEach(mat => { if(mat.map !== loadedTextures[diffuseMapName]) mat.map = loadedTextures[diffuseMapName]; mat.needsUpdate = true; });
                                 } else {
                                     if(child.material.map !== loadedTextures[diffuseMapName]) child.material.map = loadedTextures[diffuseMapName];
                                     child.material.needsUpdate = true;
                                 }
                             }
                        }
                    }
                });
            }
        }
    };

    for (const file of files) {
        const objectURL = URL.createObjectURL(file);
        textureLoader.load(
            objectURL,
            (texture) => {
                texture.name = file.name; // Store original file name
                loadedTextures[file.name.toLowerCase()] = texture; // Store by lowercase name
                console.log(`Loaded texture: ${file.name}`);
                URL.revokeObjectURL(objectURL);
                checkAllLoaded();
            },
            undefined,
            (error) => {
                console.error(`Error loading texture ${file.name}:`, error);
                URL.revokeObjectURL(objectURL);
                checkAllLoaded();
            }
        );
    }
}


function buildThreeJSModel(a3dData) {
    const threeMaterials = a3dData.materials.map(matData => {
        const params = {
            name: matData.name,
            color: new THREE.Color().fromArray(matData.color),
            roughness: 0.8, // Default
            metalness: 0.1, // Default
        };
        // Attempt to find texture
        if (matData.diffuseMap) {
            const diffuseMapName = matData.diffuseMap.toLowerCase().split(/[\\/]/).pop(); // Get filename
            if (loadedTextures[diffuseMapName]) {
                params.map = loadedTextures[diffuseMapName];
            }
        }
        const material = new THREE.MeshStandardMaterial(params);
        material.userData.a3dMaterialData = matData; // Store original data
        return material;
    });

    const threeMeshesData = a3dData.meshes.map(meshData => {
        const geometry = new THREE.BufferGeometry();
        let positions = [];
        let uvs = [];
        let normals = [];

        meshData.vertexBuffers.forEach(vb => {
            if (vb.bufferType === A3D_VERTEXTYPE_COORDINATE) {
                vb.data.forEach(v => positions.push(...v));
            } else if (vb.bufferType === A3D_VERTEXTYPE_UV1) {
                vb.data.forEach(uv => uvs.push(uv[0], 1.0 - uv[1])); // Mirror Y for UV
            } else if (vb.bufferType === A3D_VERTEXTYPE_NORMAL1) {
                vb.data.forEach(n => normals.push(...n));
            }
            // Add more vertex types if needed (UV2, Color, Normal2)
        });

        if (positions.length > 0) geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (uvs.length > 0) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        
        if (normals.length > 0) {
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        } else if (positions.length > 0) {
            geometry.computeVertexNormals(); // Calculate if not provided
        }

        // Handle indices and material groups
        let allIndices = [];
        if (meshData.submeshes.length > 0) {
            if (a3dData.version === 2) { // V2: submeshes define material groups
                meshData.submeshes.forEach((sm, index) => {
                    geometry.addGroup(allIndices.length, sm.indices.length, sm.materialID !== null ? sm.materialID : 0);
                    allIndices.push(...sm.indices);
                });
            } else { // V3: submeshes are just index lists, materials assigned by A3DObject
                 meshData.submeshes.forEach(sm => {
                    allIndices.push(...sm.indices);
                });
            }
        }
        if (allIndices.length > 0) geometry.setIndex(allIndices);
        
        return { geometry, a3dMeshData: meshData };
    });

    const objectMap = {}; // For parenting { originalIndex: THREE.Object3D }

    a3dData.objects.forEach((objData, index) => {
        const meshInfo = threeMeshesData[objData.meshID];
        if (!meshInfo) {
            console.warn(`Mesh ID ${objData.meshID} not found for object ${index}`);
            return;
        }
        
        let objectMaterials = [];
        if (a3dData.version === 2) {
            // For V2, materials are per submesh, handled by geometry groups.
            // We might need to collect all materials used by the submeshes of this mesh.
            const usedMaterialIndexes = new Set();
            a3dData.meshes[objData.meshID].submeshes.forEach(sm => {
                if (sm.materialID !== null) usedMaterialIndexes.add(sm.materialID);
            });
            if (usedMaterialIndexes.size > 0) {
                 usedMaterialIndexes.forEach(idx => objectMaterials.push(threeMaterials[idx]));
            } else if (threeMaterials.length > 0) {
                 objectMaterials.push(threeMaterials[0]); // Fallback or if no submesh mats
            } else {
                objectMaterials.push(new THREE.MeshStandardMaterial({color: 0xdddddd}));
            }
             if (objectMaterials.length === 1 && geometry.groups.length > 1) {
                // If only one material but multiple groups, Three.js might behave unexpectedly.
                // It's better to ensure the material array matches group expectations or simplify.
                // For now, we'll use the array. If issues, use just objectMaterials[0].
            }

        } else { // V3
            objData.materialIDs.forEach(matID => {
                if (matID >= 0 && matID < threeMaterials.length) {
                    objectMaterials.push(threeMaterials[matID]);
                }
            });
            if (objectMaterials.length === 0 && threeMaterials.length > 0) {
                objectMaterials.push(threeMaterials[0]); // Default if no specific material
            } else if (objectMaterials.length === 0) {
                 objectMaterials.push(new THREE.MeshStandardMaterial({color: 0xcccccc})); // Ultimate fallback
            }
        }


        const threeMesh = new THREE.Mesh(meshInfo.geometry, objectMaterials.length > 1 ? objectMaterials : objectMaterials[0]);
        
        let objName = objData.name || meshInfo.a3dMeshData.name || `Object_${index}`;
        threeMesh.name = objName;

        const transformData = a3dData.transforms[objData.transformID];
        if (transformData) {
            threeMesh.position.fromArray(transformData.position);
            threeMesh.quaternion.fromArray(transformData.rotation); // x, y, z, w
            threeMesh.scale.fromArray(transformData.scale);
             if (transformData.scale.every(s => s === 0)) { // Reset empty transform scale
                threeMesh.scale.set(1,1,1);
            }
        }

        // Store original data for reference (e.g., texture auto-apply)
        threeMesh.userData.a3dObjectData = objData;
        threeMesh.userData.a3dTransformData = transformData;
        // Material data is more complex if multiple are used, could store an array of original material data
        if(objectMaterials.length === 1) threeMesh.userData.a3dMaterialData = objectMaterials[0].userData.a3dMaterialData;

        // Attempt to auto-apply pre-loaded textures based on name
        const objectNameLower = objName.toLowerCase();
        let textureToApply = null;
        if (objectNameLower.includes("hull") || objectNameLower.includes("turret")) {
            textureToApply = loadedTextures['lightmap.webp'];
        } else if (objectNameLower.includes("track")) {
            textureToApply = loadedTextures['tracks.webp'];
        } else if (objectNameLower.includes("wheel")) {
            textureToApply = loadedTextures['wheels.webp'];
        }
        if (textureToApply) {
            if (Array.isArray(threeMesh.material)) {
                threeMesh.material.forEach(mat => mat.map = textureToApply);
            } else {
                threeMesh.material.map = textureToApply;
            }
        }


        loadedObjects.push(threeMesh);
        objectMap[index] = threeMesh; // For parenting
        // modelGroup.add(threeMesh); // Will be added via parenting or directly if no parent
        addToListUI(threeMesh, index);
    });

    // Setup parenting
    loadedObjects.forEach((obj, originalIndex) => {
        const parentID = a3dData.transformParentIDs[a3dData.objects[originalIndex].transformID]; // This is tricky, parentID is for transform index
        
        let actualParentId = -1;
        if (a3dData.version < 3 && parentID === 0) { // V2 uses 0 for no parent
            actualParentId = -1;
        } else if (parentID === -1) { // V3 uses -1 for no parent
             actualParentId = -1;
        } else {
            actualParentId = parentID;
        }
        
        // Find the object that USES this transformID as its parent
        // The parentID in transformParentIDs corresponds to the *index* of the parent transform in a3dData.transforms.
        // We need to find which THREE.Object3D corresponds to that parent transform.
        let parentObject = null;
        if (actualParentId !== -1) {
            // Find which loaded object (THREE.Mesh) uses this parent transform
            for (let i = 0; i < a3dData.objects.length; i++) {
                if (a3dData.objects[i].transformID === actualParentId) {
                    parentObject = objectMap[i]; // objectMap stores THREE.Mesh by its original a3dData.objects index
                    break;
                }
            }
        }


        if (parentObject && parentObject !== obj) {
            parentObject.add(obj);
        } else {
            modelGroup.add(obj); // Add to root if no parent or parent is self
        }
    });

    // Optional: Auto-zoom
    if (loadedObjects.length > 0) {
        const box = new THREE.Box3().setFromObject(modelGroup);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        
        controls.reset(); // Important before setting new target/position

        const maxSize = Math.max(size.x, size.y, size.z);
        const fitHeightDistance = maxSize / (2 * Math.atan(Math.PI * camera.fov / 360));
        const fitWidthDistance = fitHeightDistance / camera.aspect;
        const distance = 1.2 * Math.max(fitHeightDistance, fitWidthDistance);

        const direction = controls.object.position.clone().sub(center).normalize().multiplyScalar(distance);
        controls.object.position.copy(center).add(direction);
        controls.target.copy(center);
        controls.update();
    }
}


function addToListUI(object, id) {
    const listItem = document.createElement('li');
    listItem.textContent = object.name || `Unnamed Object ${id}`;
    listItem.dataset.objectId = object.uuid; // Use Three.js UUID
    listItem.addEventListener('click', () => {
        selectObjectUI(object);
    });
    objectListUI.appendChild(listItem);
}

function selectObjectUI(object) {
    if (selectedObject) {
        // Deselect previous: remove highlight, find its <li>
        selectedObject.traverse(child => {
            if (child.isMesh) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.emissive.setHex(0x000000));
                else child.material.emissive.setHex(0x000000);
            }
        });
        const oldLi = objectListUI.querySelector(`[data-object-id="${selectedObject.uuid}"]`);
        if (oldLi) oldLi.classList.remove('selected');
    }

    selectedObject = object;

    if (selectedObject) {
        // Select new: add highlight, find its <li>
        selectedObject.traverse(child => {
             if (child.isMesh) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.emissive.setHex(0x555500));
                else child.material.emissive.setHex(0x555500); // Highlight
            }
        });
        const newLi = objectListUI.querySelector(`[data-object-id="${selectedObject.uuid}"]`);
        if (newLi) newLi.classList.add('selected');
        deleteButton.disabled = false;
    } else {
        deleteButton.disabled = true;
    }
}

function deleteSelected() {
    if (!selectedObject) return;

    // Remove from scene graph
    selectedObject.parent.remove(selectedObject);

    // Dispose geometry and material(s)
    selectedObject.traverse(child => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => mat.dispose());
                } else {
                    child.material.dispose();
                }
            }
        }
    });
    
    // Remove from our tracking array
    const index = loadedObjects.indexOf(selectedObject);
    if (index > -1) loadedObjects.splice(index, 1);

    // Remove from UI list
    const listItem = objectListUI.querySelector(`[data-object-id="${selectedObject.uuid}"]`);
    if (listItem) listItem.remove();

    selectedObject = null;
    deleteButton.disabled = true;
}

// --- Raycasting for selection ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let touchHandled = false; // Prevent click after touch


function onMouseClick(event) {
    if (touchHandled) {
        touchHandled = false;
        return;
    }
    handleInteraction(event.clientX, event.clientY);
}

function onTouchStart(event) {
    if (event.touches.length === 1) { // single touch
        handleInteraction(event.touches[0].clientX, event.touches[0].clientY);
        touchHandled = true; // Set flag
    }
}


function handleInteraction(x, y) {
    // Adjust mouse position to be relative to the viewerContainer and normalized
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((y - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(loadedObjects, true); // Intersect with children

    if (intersects.length > 0) {
        let intersectedObject = intersects[0].object;
        // Traverse up to find the object that's directly in loadedObjects (the parent-most object we added)
        while(intersectedObject.parent && intersectedObject.parent !== modelGroup && loadedObjects.indexOf(intersectedObject) === -1) {
            intersectedObject = intersectedObject.parent;
        }
        if (loadedObjects.indexOf(intersectedObject) !== -1) {
             selectObjectUI(intersectedObject);
        } else {
            selectObjectUI(null); // Clicked on something not in our main list
        }
    } else {
        selectObjectUI(null); // Clicked on empty space
    }
}


// Event Listeners for UI
document.getElementById('a3dFile').addEventListener('change', (event) => {
    if (event.target.files.length > 0) {
        handleA3DFile(event.target.files[0]);
    }
});

document.getElementById('textureFiles').addEventListener('change', (event) => {
    if (event.target.files.length > 0) {
        handleTextureFiles(event.target.files);
    }
});

deleteButton.addEventListener('click', deleteSelected);

// --- Start ---
initThreeJS();
