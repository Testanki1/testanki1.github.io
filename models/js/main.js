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

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // Slightly brighter ambient
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2); // Slightly brighter directional
    directionalLight.position.set(1, 1.5, 1).normalize();
    scene.add(directionalLight);
    
    const gridHelper = new THREE.GridHelper( 200, 20, 0x000000, 0x000000 );
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    scene.add( gridHelper );

    window.addEventListener('resize', onWindowResize, false);
    renderer.domElement.addEventListener('click', onMouseClick, false);
    renderer.domElement.addEventListener('touchstart', onTouchStart, false);

    animate();
}

function computeViewerHeight() {
    const controlsHeight = document.getElementById('controls').offsetHeight;
    return Math.max(100, window.innerHeight - controlsHeight); // Ensure a minimum height
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
        modelGroup.traverse(object => {
            if (object.isMesh) {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(mat => {
                            if (mat.map) mat.map.dispose();
                            mat.dispose();
                        });
                    } else {
                        if (object.material.map) object.material.map.dispose();
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
    // Do not clear loadedTextures here, allow them to persist for next model
}

function handleA3DFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            clearScene(); // Clear previous model but keep textures
            const a3dData = new A3D().parse(event.target.result);
            console.log("Parsed A3D Data:", a3dData);
            // console.log("Parsed A3D Materials for Texture Check:", JSON.stringify(a3dData.materials, null, 2));
            buildThreeJSModel(a3dData);
        } catch (error) {
            console.error("Error parsing/building A3D model:", error.stack || error);
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
            console.log("All new textures processed. Re-applying materials if model exists.");
            // console.log("Currently loaded textures:", loadedTextures);
             if (modelGroup && modelGroup.children.length > 0) {
                modelGroup.traverse(child => {
                    if (child.isMesh) {
                        const a3dObj = child.userData.a3dObjectData;
                        
                        let appliedByObjName = false;
                        // Try applying by specific object name patterns (e.g., hull, track)
                        if (a3dObj && (a3dObj.name || child.name)) {
                            const objectNameLower = (a3dObj.name || child.name || "").toLowerCase();
                            let textureToApply = null;
                            if (objectNameLower.includes("hull") || objectNameLower.includes("turret")) {
                                textureToApply = loadedTextures['lightmap.webp'];
                            } else if (objectNameLower.includes("track")) {
                                textureToApply = loadedTextures['tracks.webp'];
                            } else if (objectNameLower.includes("wheel")) {
                                textureToApply = loadedTextures['wheels.webp'];
                            }

                            if (textureToApply) {
                                appliedByObjName = true;
                                const materials = Array.isArray(child.material) ? child.material : [child.material];
                                materials.forEach(mat => {
                                    if(mat.map !== textureToApply) { mat.map = textureToApply; mat.needsUpdate = true; }
                                });
                                // console.log(`Applied texture ${textureToApply.name} by object name rule to ${child.name}`);
                            }
                        }
                        
                        // If not applied by object name, try based on material's original diffuseMap
                        if (!appliedByObjName) {
                            const materialsToUpdate = Array.isArray(child.material) ? child.material : [child.material];
                            materialsToUpdate.forEach(matInstance => {
                                const originalMatData = matInstance.userData.a3dMaterialData;
                                if (originalMatData && originalMatData.diffuseMap) {
                                    const diffuseMapName = originalMatData.diffuseMap.toLowerCase().split(/[\\/]/).pop();
                                     if (loadedTextures[diffuseMapName] && matInstance.map !== loadedTextures[diffuseMapName]) {
                                         matInstance.map = loadedTextures[diffuseMapName];
                                         matInstance.needsUpdate = true;
                                         // console.log(`Re-applied texture ${diffuseMapName} from A3D material to ${child.name}`);
                                     }
                                }
                            });
                        }
                    }
                });
                 renderer.render(scene, camera); // Re-render if textures changed
            }
        }
    };

    for (const file of files) {
        const objectURL = URL.createObjectURL(file);
        textureLoader.load(
            objectURL,
            (texture) => {
                texture.name = file.name; 
                const lowerCaseName = file.name.toLowerCase();
                loadedTextures[lowerCaseName] = texture; 
                console.log(`Loaded texture: ${file.name} (stored as ${lowerCaseName})`);
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
    console.log("Building ThreeJS model. A3D File Version:", a3dData.version);

    const threeMaterials = a3dData.materials.map((matData, matIndex) => {
        const params = {
            name: matData.name || `A3DMaterial_${matIndex}`,
            color: new THREE.Color().fromArray(matData.color),
            roughness: 0.7, 
            metalness: 0.2, 
            side: THREE.FrontSide, // Default, can be THREE.DoubleSide if needed
        };
        if (matData.diffuseMap) {
            const diffuseMapName = matData.diffuseMap.toLowerCase().split(/[\\/]/).pop();
            if (loadedTextures[diffuseMapName]) {
                params.map = loadedTextures[diffuseMapName];
                console.log(`Material '${params.name}': Applied texture '${diffuseMapName}' during material creation.`);
            } else {
                console.log(`Material '${params.name}': Texture '${diffuseMapName}' (from diffuseMap: ${matData.diffuseMap}) NOT FOUND in loadedTextures at build time.`);
            }
        }
        const material = new THREE.MeshStandardMaterial(params);
        material.userData.a3dMaterialData = matData; 
        return material;
    });

    const threeMeshesData = a3dData.meshes.map((meshData, meshIndex) => {
        const meshA3DName = (meshData && meshData.name) ? meshData.name : `UnnamedA3DMesh_${meshIndex}`;
        console.log(`Processing mesh index: ${meshIndex}, A3D Mesh Name: '${meshA3DName}'`);

        if (!meshData) {
            console.error(`CRITICAL: meshData at index ${meshIndex} is null or undefined! This indicates a parser issue. Skipping mesh.`);
            return { geometry: null, a3dMeshData: { name: `ErrorMesh_${meshIndex}`, submeshes:[] } };
        }

        let currentMeshGeometry; // Use a distinct name
        try {
            currentMeshGeometry = new THREE.BufferGeometry();
            currentMeshGeometry.name = `GeometryFor_${meshA3DName}`;
            // console.log(`Mesh ${meshIndex} ('${meshA3DName}'): THREE.BufferGeometry created successfully.`);
        } catch (e) {
            console.error(`Mesh ${meshIndex} ('${meshA3DName}'): Error creating THREE.BufferGeometry:`, e.stack || e);
            alert(`Error creating BufferGeometry for mesh ${meshIndex} ('${meshA3DName}'): ${e.message}`);
            throw e; 
        }

        let positions = [], uvs = [], normals = [];
        (meshData.vertexBuffers || []).forEach(vb => {
            if (!vb || !vb.data) {
                 console.warn(`Mesh ${meshIndex} ('${meshA3DName}'): Skipping malformed vertex buffer.`);
                 return;
            }
            if (vb.bufferType === A3D_VERTEXTYPE_COORDINATE) vb.data.forEach(v => positions.push(...v));
            else if (vb.bufferType === A3D_VERTEXTYPE_UV1) vb.data.forEach(uv => uvs.push(uv[0], 1.0 - uv[1])); 
            else if (vb.bufferType === A3D_VERTEXTYPE_NORMAL1) vb.data.forEach(n => normals.push(...n));
        });

        if (positions.length > 0) {
            if (!currentMeshGeometry) console.error(`Mesh ${meshIndex} ('${meshA3DName}'): currentMeshGeometry is undefined BEFORE setAttribute('position')`);
            currentMeshGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        } else {
            console.warn(`Mesh ${meshIndex} ('${meshA3DName}'): No position data found!`);
            // Return a dummy geometry to prevent downstream errors if this mesh is referenced
            return { geometry: new THREE.BufferGeometry(), a3dMeshData: meshData };
        }

        if (uvs.length > 0) {
            if (!currentMeshGeometry) console.error(`Mesh ${meshIndex} ('${meshA3DName}'): currentMeshGeometry is undefined BEFORE setAttribute('uv')`);
            currentMeshGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        } else {
            console.log(`Mesh ${meshIndex} ('${meshA3DName}'): No UVs found in vertex buffers.`);
        }
        
        if (normals.length > 0) {
            if (!currentMeshGeometry) console.error(`Mesh ${meshIndex} ('${meshA3DName}'): currentMeshGeometry is undefined BEFORE setAttribute('normal')`);
            currentMeshGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        } else {
            if (!currentMeshGeometry) console.error(`Mesh ${meshIndex} ('${meshA3DName}'): currentMeshGeometry is undefined BEFORE computeVertexNormals`);
            currentMeshGeometry.computeVertexNormals(); 
            console.log(`Mesh ${meshIndex} ('${meshA3DName}'): Normals computed as none were provided.`);
        }

        let allIndices = [];
        if (meshData.submeshes && meshData.submeshes.length > 0) {
            if (a3dData.version === 2) {
                meshData.submeshes.forEach((sm, submeshIndex) => {
                    if (!currentMeshGeometry) {
                        const errorMsg = `CRITICAL ERROR: Mesh ${meshIndex} ('${meshA3DName}'), Submesh ${submeshIndex}: currentMeshGeometry is undefined BEFORE addGroup!`;
                        console.error(errorMsg); alert(errorMsg); throw new Error(errorMsg);
                    }
                    if (sm && sm.indices && Array.isArray(sm.indices) && typeof sm.materialID !== 'undefined') { 
                        currentMeshGeometry.addGroup(allIndices.length, sm.indices.length, sm.materialID !== null ? sm.materialID : 0);
                        allIndices.push(...sm.indices);
                    } else {
                        console.warn(`Mesh ${meshIndex} ('${meshA3DName}'), Submesh ${submeshIndex}: Malformed V2 submesh data or missing indices. Skipping addGroup. Data:`, sm);
                    }
                });
            } else { // V3
                 meshData.submeshes.forEach((sm, submeshIndex) => {
                    if (sm && sm.indices && Array.isArray(sm.indices)) {
                        allIndices.push(...sm.indices);
                    } else {
                         console.warn(`Mesh ${meshIndex} ('${meshA3DName}'), V3 Submesh ${submeshIndex}: Malformed submesh data or missing indices. Data:`, sm);
                    }
                });
            }
        } else {
            console.log(`Mesh ${meshIndex} ('${meshA3DName}'): No submeshes defined or submeshes array is empty.`);
        }

        if (allIndices.length > 0) {
            if (!currentMeshGeometry) console.error(`Mesh ${meshIndex} ('${meshA3DName}'): currentMeshGeometry is undefined BEFORE setIndex`);
            currentMeshGeometry.setIndex(allIndices);
        } else if (positions.length > 0 && (!meshData.submeshes || meshData.submeshes.length === 0)) {
            // If no submeshes provided indices, but we have positions, assume non-indexed geometry or direct vertex order
            console.log(`Mesh ${meshIndex} ('${meshA3DName}'): No indices from submeshes. Will render as non-indexed or expect implicit indices.`);
        }
        
        if (!currentMeshGeometry) console.error(`Mesh ${meshIndex} ('${meshA3DName}'): currentMeshGeometry is undefined BEFORE return from map function`);
        return { geometry: currentMeshGeometry, a3dMeshData: meshData };
    });

    const objectMap = {}; 

    a3dData.objects.forEach((objData, objIndex) => {
        const objA3DName = (objData && objData.name) ? objData.name : `UnnamedA3DObject_${objIndex}`;
        // console.log(`Processing object index: ${objIndex}, A3D Object Name: '${objA3DName}'`);

        if (!objData || typeof objData.meshID === 'undefined') {
            console.warn(`Object ${objIndex} ('${objA3DName}'): Invalid object data or missing meshID. Skipping.`);
            return;
        }
        const meshInfo = threeMeshesData[objData.meshID];
        if (!meshInfo || !meshInfo.geometry) {
            console.warn(`Object ${objIndex} ('${objA3DName}'): Mesh ID ${objData.meshID} not found, or its geometry is null. Skipping object.`);
            return;
        }
        
        let objectMaterials = [];
        if (a3dData.version === 2) {
            const usedMaterialIndexes = new Set();
            if (meshInfo.a3dMeshData && meshInfo.a3dMeshData.submeshes) {
                meshInfo.a3dMeshData.submeshes.forEach(sm => {
                    if (sm.materialID !== null && sm.materialID >= 0) usedMaterialIndexes.add(sm.materialID);
                });
            }
            if (usedMaterialIndexes.size > 0) {
                 usedMaterialIndexes.forEach(idx => {
                    if (idx < threeMaterials.length) objectMaterials.push(threeMaterials[idx]);
                    else console.warn(`Object ${objIndex} ('${objA3DName}'), V2: Invalid materialID ${idx} (max: ${threeMaterials.length-1}) found in submesh.`);
                 });
            } else if (threeMaterials.length > 0) { // If no specific submesh materials, or all were null
                 objectMaterials.push(threeMaterials[0]); 
            }
             // If geometry has groups, material array must be used, even if it's one material repeated.
            if (meshInfo.geometry.groups.length > 1 && objectMaterials.length === 1) {
                // This scenario is fine, Three.js will use the single material for all groups.
            } else if (meshInfo.geometry.groups.length > 0 && objectMaterials.length === 0 && threeMaterials.length > 0) {
                objectMaterials.push(threeMaterials[0]); // Fallback if groups exist but no mats assigned
            }


        } else { // V3
            if (objData.materialIDs && objData.materialIDs.length > 0) {
                objData.materialIDs.forEach(matID => {
                    if (matID >= 0 && matID < threeMaterials.length) {
                        objectMaterials.push(threeMaterials[matID]);
                    } else if (matID !== -1) { 
                        console.warn(`Object ${objIndex} ('${objA3DName}'), V3: Invalid materialID ${matID} (max: ${threeMaterials.length-1}).`);
                    }
                });
            }
            // If V3 object has no materialIDs listed, or all were -1, use the first material as a default
            if (objectMaterials.length === 0 && threeMaterials.length > 0) {
                objectMaterials.push(threeMaterials[0]); 
            }
        }
        // Ultimate fallback if no materials resolved
        if (objectMaterials.length === 0) {
            objectMaterials.push(new THREE.MeshStandardMaterial({color: 0xmagenta, name: `SuperFallbackMaterial_Obj${objIndex}`}));
        }


        const finalMaterial = objectMaterials.length > 1 ? objectMaterials : objectMaterials[0];
        const threeMesh = new THREE.Mesh(meshInfo.geometry, finalMaterial);
        
        threeMesh.name = objData.name || meshInfo.a3dMeshData.name || `ThreeObject_${objIndex}`;

        const transformData = a3dData.transforms[objData.transformID];
        if (transformData) {
            threeMesh.position.fromArray(transformData.position);
            threeMesh.quaternion.fromArray(transformData.rotation); 
            threeMesh.scale.fromArray(transformData.scale);
             if (transformData.scale.every(s => Math.abs(s) < 1e-6)) { // Check for effectively zero scale
                // console.warn(`Object ${threeMesh.name}: Transform scale was zero, resetting to 1,1,1.`);
                threeMesh.scale.set(1,1,1);
            }
        }

        threeMesh.userData.a3dObjectData = objData;
        threeMesh.userData.a3dTransformData = transformData;
        // Store original a3dMaterialData on the THREE.Material instances themselves (done during threeMaterials.map)
        // For quick access, can store reference on threeMesh.userData if needed, but primary is on mat instance

        // Auto-apply textures by object name (e.g. 'lightmap.webp' for 'hull')
        // This overrides textures set via A3D material diffuseMap if names match
        const objectNameLower = threeMesh.name.toLowerCase();
        let textureToApplyByName = null;
        if (objectNameLower.includes("hull") || objectNameLower.includes("turret")) textureToApplyByName = loadedTextures['lightmap.webp'];
        else if (objectNameLower.includes("track")) textureToApplyByName = loadedTextures['tracks.webp'];
        else if (objectNameLower.includes("wheel")) textureToApplyByName = loadedTextures['wheels.webp'];
        
        if (textureToApplyByName) {
            // console.log(`Object ${threeMesh.name}: Applying texture '${textureToApplyByName.name}' based on object name rule.`);
            const matsToUpdate = Array.isArray(threeMesh.material) ? threeMesh.material : [threeMesh.material];
            matsToUpdate.forEach(mat => {
                mat.map = textureToApplyByName;
                mat.needsUpdate = true;
            });
        }

        loadedObjects.push(threeMesh);
        objectMap[objIndex] = threeMesh; 
        addToListUI(threeMesh, objIndex);
    });

    // Setup parenting
    loadedObjects.forEach((threeJsObjInstance) => { // Renamed 'obj' to avoid confusion with a3d objData
        const a3dObjDataForThisThreeMesh = threeJsObjInstance.userData.a3dObjectData;
        if (!a3dObjDataForThisThreeMesh) {
             console.warn(`Parenting: Cannot find original a3dObjectData for Three.js object ${threeJsObjInstance.name}. Adding to root.`);
             modelGroup.add(threeJsObjInstance);
             return;
        }
        const transformIDForObject = a3dObjDataForThisThreeMesh.transformID;
         if (typeof transformIDForObject === 'undefined' || transformIDForObject === null || transformIDForObject >= a3dData.transforms.length) {
            // console.log(`Parenting: Object ${threeJsObjInstance.name} has no valid transformID or out of bounds. Adding to root.`);
            modelGroup.add(threeJsObjInstance);
            return;
        }

        const parentTransformIndex = a3dData.transformParentIDs[transformIDForObject];
        
        let actualParentTransformTargetIndex = -1; 
        if (a3dData.version < 3) { 
            actualParentTransformTargetIndex = (parentTransformIndex === 0 || typeof parentTransformIndex === 'undefined') ? -1 : parentTransformIndex;
        } else { 
             actualParentTransformTargetIndex = (parentTransformIndex === -1 || typeof parentTransformIndex === 'undefined') ? -1 : parentTransformIndex;
        }
        
        let parentThreeJsObject = null;
        if (actualParentTransformTargetIndex !== -1) {
            // Find which THREE.Object3D (loadedObject) USES this parentTransformIndex for ITS OWN transform
            for (let i = 0; i < a3dData.objects.length; i++) {
                const potentialParentA3dObj = a3dData.objects[i];
                if (potentialParentA3dObj && potentialParentA3dObj.transformID === actualParentTransformTargetIndex) {
                    parentThreeJsObject = objectMap[i]; // objectMap maps a3dData.objects index to THREE.Object3D
                    break;
                }
            }
        }

        if (parentThreeJsObject && parentThreeJsObject !== threeJsObjInstance) {
            parentThreeJsObject.add(threeJsObjInstance);
        } else {
            modelGroup.add(threeJsObjInstance); 
        }
    });

    // Auto-zoom
    if (loadedObjects.length > 0 && modelGroup.children.length > 0) {
        const box = new THREE.Box3().setFromObject(modelGroup);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        
        if (!isFinite(center.x) || !isFinite(size.x) || size.x < 0) {
            console.warn("Auto-zoom: Invalid bounding box calculated. Skipping auto-zoom.", center, size);
        } else {
            controls.reset(); 
            const maxSize = Math.max(size.x, size.y, size.z);
            const fovInRadians = camera.fov * (Math.PI / 180);
            let distance = maxSize / (2 * Math.tan(fovInRadians / 2));
            distance /= camera.aspect; // Adjust for width if wider than high for typical aspect ratios
            distance *= 1.5; // Zoom out a bit more
            distance = Math.max(distance, Math.max(size.x, size.y, size.z) * 0.5); // ensure not too close for flat objects
            distance = Math.max(distance, 10); // Minimum distance

            const direction = new THREE.Vector3(0, 0.5, 1); // Default camera direction relative to target
            direction.applyQuaternion(camera.quaternion); // Maintain current camera orientation if desired
            direction.normalize().multiplyScalar(distance);
            
            controls.object.position.copy(center).add(direction);
            controls.target.copy(center);
            controls.update();
        }
    } else {
        // console.log("Auto-zoom: No objects loaded or modelGroup is empty.");
        controls.reset();
        camera.position.set(50,50,50);
        controls.target.set(0,0,0);
        controls.update();
    }
}


function addToListUI(object, id) {
    const listItem = document.createElement('li');
    listItem.textContent = `${object.name || `Unnamed Object`} (ID: ${id})`;
    listItem.dataset.objectId = object.uuid; 
    listItem.addEventListener('click', () => {
        selectObjectUI(object);
    });
    objectListUI.appendChild(listItem);
}

function selectObjectUI(object) {
    if (selectedObject) {
        selectedObject.traverse(child => {
            if (child.isMesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(m => { if(m.emissive) m.emissive.setHex(0x000000) });
            }
        });
        const oldLi = objectListUI.querySelector(`[data-object-id="${selectedObject.uuid}"]`);
        if (oldLi) oldLi.classList.remove('selected');
    }

    selectedObject = object;

    if (selectedObject) {
        selectedObject.traverse(child => {
             if (child.isMesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(m => { if(m.emissive) m.emissive.setHex(0x888800) }); // Brighter highlight
            }
        });
        const newLi = objectListUI.querySelector(`[data-object-id="${selectedObject.uuid}"]`);
        if (newLi) newLi.classList.add('selected');
        deleteButton.disabled = false;
    } else {
        deleteButton.disabled = true;
    }
     renderer.render(scene, camera); // Re-render for highlight change
}

function deleteSelected() {
    if (!selectedObject) return;
    if (selectedObject.parent) { // Check if it has a parent before removing
        selectedObject.parent.remove(selectedObject);
    } else {
        console.warn("Selected object has no parent, cannot remove from parent.", selectedObject);
        // Potentially remove from modelGroup directly if it's a root object not handled by parenting logic
        modelGroup.remove(selectedObject);
    }
    
    selectedObject.traverse(child => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                        if (mat.map) mat.map.dispose();
                        mat.dispose();
                    });
                } else {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            }
        }
    });
    
    const index = loadedObjects.indexOf(selectedObject);
    if (index > -1) loadedObjects.splice(index, 1);

    const listItem = objectListUI.querySelector(`[data-object-id="${selectedObject.uuid}"]`);
    if (listItem) listItem.remove();

    selectedObject = null;
    deleteButton.disabled = true;
    renderer.render(scene, camera); // Re-render after deletion
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let touchHandled = false; 

function onMouseClick(event) {
    if (touchHandled) {
        touchHandled = false;
        return;
    }
    handleInteraction(event.clientX, event.clientY);
}

function onTouchStart(event) {
    if (event.touches.length === 1) { 
        handleInteraction(event.touches[0].clientX, event.touches[0].clientY);
        touchHandled = true; 
    }
}

function handleInteraction(x, y) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((y - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(modelGroup.children, true); // Intersect with direct children of modelGroup

    if (intersects.length > 0) {
        let intersectedObject = intersects[0].object;
        // Traverse up to find the object that's directly in loadedObjects 
        // (or is a direct child of modelGroup that we track)
        while(intersectedObject.parent && intersectedObject.parent !== modelGroup && loadedObjects.indexOf(intersectedObject) === -1) {
            intersectedObject = intersectedObject.parent;
        }
        if (loadedObjects.indexOf(intersectedObject) !== -1) {
             selectObjectUI(intersectedObject);
        } else {
            // If not in loadedObjects (e.g. a part of a complex hierarchy not directly added)
            // try selecting the top-level parent that is part of modelGroup
            let topLevelChild = intersects[0].object;
            while (topLevelChild.parent && topLevelChild.parent !== modelGroup) {
                topLevelChild = topLevelChild.parent;
            }
            if (topLevelChild.parent === modelGroup && loadedObjects.includes(topLevelChild)) {
                 selectObjectUI(topLevelChild);
            } else {
                selectObjectUI(null); 
            }
        }
    } else {
        selectObjectUI(null); 
    }
}

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

initThreeJS();
