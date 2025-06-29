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
const rotateModelCheckbox = document.getElementById('rotateModelCheckbox');

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
    rotateModelCheckbox.addEventListener('change', applyModelRotation);


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

function applyModelRotation() {
    if (modelGroup) {
        if (rotateModelCheckbox.checked) {
            modelGroup.rotation.x = -Math.PI / 2; // Rotate -90 degrees around X-axis
        } else {
            modelGroup.rotation.x = 0; // Reset rotation
        }
    }
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
                        const a3dMatDataFromMesh = child.userData.a3dMaterialData; // And this (can be single or array)

                        let textureToApply = null;
                        let diffuseMapNameFromMaterial = null;

                        if (a3dObj && a3dObj.name) {
                            const objectNameLower = a3dObj.name.toLowerCase();
                            if (objectNameLower.includes("hull") || objectNameLower.includes("turret")) {
                                textureToApply = loadedTextures['lightmap.webp'];
                            } else if (objectNameLower.includes("track")) {
                                textureToApply = loadedTextures['tracks.webp'];
                            } else if (objectNameLower.includes("wheel")) {
                                textureToApply = loadedTextures['wheels.webp'];
                            }
                        }

                        // If not found by object name, try by stored A3D material diffuseMap
                        // This part is a bit tricky because a mesh can have multiple materials.
                        // We'll iterate through materials if it's an array.
                        if (!textureToApply && a3dMatDataFromMesh) {
                            const materialsToUpdate = Array.isArray(child.material) ? child.material : [child.material];
                            const originalA3DMaterials = Array.isArray(a3dMatDataFromMesh) ? a3dMatDataFromMesh : [a3dMatDataFromMesh];

                            materialsToUpdate.forEach((threeMat, index) => {
                                const currentA3DMat = originalA3DMaterials[index] || (originalA3DMaterials.length === 1 ? originalA3DMaterials[0] : null);
                                if (currentA3DMat && currentA3DMat.diffuseMap) {
                                    const diffuseMapName = currentA3DMat.diffuseMap.toLowerCase().split(/[\\/]/).pop();
                                    if (loadedTextures[diffuseMapName] && threeMat.map !== loadedTextures[diffuseMapName]) {
                                        threeMat.map = loadedTextures[diffuseMapName];
                                        threeMat.needsUpdate = true;
                                    }
                                }
                            });
                        }


                        if (textureToApply) { // This textureToApply is from object name heuristic
                             if (Array.isArray(child.material)) {
                                child.material.forEach(mat => {
                                    if (mat.map !== textureToApply) {
                                        mat.map = textureToApply;
                                        mat.needsUpdate = true;
                                    }
                                });
                            } else {
                                if (child.material.map !== textureToApply) {
                                    child.material.map = textureToApply;
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
    const originalA3dMaterials = []; // To store original A3D material data
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
        // material.userData.a3dMaterialData = matData; // Store original data
        originalA3dMaterials.push(matData); // Keep original data separate for reference
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

        let currentObjectMaterials = []; // THREE.Material instances for this object
        let currentObjectA3dMaterialData = []; // Original A3D material data for this object

        if (a3dData.version === 2) {
            const usedMaterialIndexes = new Set();
            a3dData.meshes[objData.meshID].submeshes.forEach(sm => {
                if (sm.materialID !== null) usedMaterialIndexes.add(sm.materialID);
            });
            if (usedMaterialIndexes.size > 0) {
                 usedMaterialIndexes.forEach(idx => {
                    currentObjectMaterials.push(threeMaterials[idx]);
                    currentObjectA3dMaterialData.push(originalA3dMaterials[idx]);
                 });
            } else if (threeMaterials.length > 0) {
                 currentObjectMaterials.push(threeMaterials[0]); // Fallback
                 currentObjectA3dMaterialData.push(originalA3dMaterials[0]);
            } else {
                const fallbackMat = new THREE.MeshStandardMaterial({color: 0xdddddd});
                currentObjectMaterials.push(fallbackMat);
                // No specific a3dMaterialData for this ultimate fallback
            }
        } else { // V3
            objData.materialIDs.forEach(matID => {
                if (matID >= 0 && matID < threeMaterials.length) {
                    currentObjectMaterials.push(threeMaterials[matID]);
                    currentObjectA3dMaterialData.push(originalA3dMaterials[matID]);
                }
            });
            if (currentObjectMaterials.length === 0 && threeMaterials.length > 0) {
                currentObjectMaterials.push(threeMaterials[0]); // Default if no specific material
                currentObjectA3dMaterialData.push(originalA3dMaterials[0]);
            } else if (currentObjectMaterials.length === 0) {
                const fallbackMat = new THREE.MeshStandardMaterial({color: 0xcccccc});
                currentObjectMaterials.push(fallbackMat);
            }
        }

        const threeMesh = new THREE.Mesh(meshInfo.geometry, currentObjectMaterials.length > 1 ? currentObjectMaterials : currentObjectMaterials[0]);

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

        threeMesh.userData.a3dObjectData = objData;
        threeMesh.userData.a3dTransformData = transformData;
        threeMesh.userData.a3dMaterialData = currentObjectA3dMaterialData.length > 1 ? currentObjectA3dMaterialData : currentObjectA3dMaterialData[0];


        // Attempt to auto-apply pre-loaded textures based on name (heuristic)
        const objectNameLower = objName.toLowerCase();
        let textureToApplyByName = null;
        if (objectNameLower.includes("hull") || objectNameLower.includes("turret")) {
            textureToApplyByName = loadedTextures['lightmap.webp'];
        } else if (objectNameLower.includes("track")) {
            textureToApplyByName = loadedTextures['tracks.webp'];
        } else if (objectNameLower.includes("wheel")) {
            textureToApplyByName = loadedTextures['wheels.webp'];
        }

        if (textureToApplyByName) {
            if (Array.isArray(threeMesh.material)) {
                threeMesh.material.forEach(mat => {
                    if (mat.map !== textureToApplyByName) { // Avoid redundant assignment and update
                        mat.map = textureToApplyByName;
                        mat.needsUpdate = true; // MODIFICATION: Added needsUpdate
                    }
                });
            } else {
                if (threeMesh.material.map !== textureToApplyByName) {
                    threeMesh.material.map = textureToApplyByName;
                    threeMesh.material.needsUpdate = true; // MODIFICATION: Added needsUpdate
                }
            }
        }

        loadedObjects.push(threeMesh);
        objectMap[index] = threeMesh; // For parenting
        addToListUI(threeMesh, index);
    });

    // Setup parenting
    loadedObjects.forEach((obj, originalIndex) => {
        const parentID = a3dData.transformParentIDs[a3dData.objects[originalIndex].transformID];
        let actualParentId = -1;
        if (a3dData.version < 3 && parentID === 0 && a3dData.transforms.length > 1) { // V2: 0 can be a valid parent if multiple transforms exist, or no parent if only one transform (root itself)
            // This logic for V2 parentID=0 might need refinement based on how A3D V2 actually exports root nodes.
            // Assuming 0 is a valid parent index unless it's the only transform, implying no explicit parent.
            // For simplicity, we'll stick to the previous interpretation: 0 means root for V2.
            // The check 'a3dData.objects[originalIndex].transformID !== 0' can be used to infer if an object with transform 0 should be parented.
             if (a3dData.objects[originalIndex].transformID === 0 && parentID === 0 && a3dData.transforms.length === 1) { // only one transform, it's root
                 actualParentId = -1;
             } else if (parentID === 0 && a3dData.transforms[a3dData.objects[originalIndex].transformID] !== a3dData.transforms[0]) { // Check if it's not trying to parent to itself implicitly
                 actualParentId = 0; // It means parent is the transform at index 0.
             } else {
                 actualParentId = -1; // Default to no parent if transformID is 0 or other ambiguous cases.
             }
             // Simplified: if parentID is 0 for V2, it often means root OR the actual 0th transform.
             // Let's assume 0 is root if the object's own transformID is also 0, otherwise it's a parent.
             // This part is still a bit ambiguous for V2 without more specific file examples.
             // The previous logic was: if (a3dData.version < 3 && parentID === 0) actualParentId = -1;
             // Sticking to a safer interpretation for now:
             if (a3dData.version < 3) {
                actualParentId = (parentID === 0 && a3dData.objects[originalIndex].transformID !== 0) ? 0 : -1;
             }

        } else if (parentID === -1) { // V3 uses -1 for no parent
             actualParentId = -1;
        } else {
            actualParentId = parentID;
        }

        let parentObject = null;
        if (actualParentId !== -1) {
            for (let i = 0; i < a3dData.objects.length; i++) {
                if (a3dData.objects[i].transformID === actualParentId) {
                    parentObject = objectMap[i];
                    break;
                }
            }
        }

        if (parentObject && parentObject !== obj) {
            parentObject.add(obj);
        } else {
            modelGroup.add(obj);
        }
    });

    applyModelRotation();

    if (loadedObjects.length > 0) {
        const box = new THREE.Box3().setFromObject(modelGroup);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        controls.reset();

        const maxSize = Math.max(size.x, size.y, size.z);
        const fitHeightDistance = maxSize / (2 * Math.atan(Math.PI * camera.fov / 360));
        const fitWidthDistance = fitHeightDistance / camera.aspect;
        const distance = 1.2 * Math.max(fitHeightDistance, fitWidthDistance, 10); // ensure min distance

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
        selectedObject.traverse(child => {
             if (child.isMesh) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.emissive.setHex(0x555500));
                else child.material.emissive.setHex(0x555500);
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

    selectedObject.parent.remove(selectedObject);

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
    const intersects = raycaster.intersectObjects(loadedObjects, true);

    if (intersects.length > 0) {
        let intersectedObject = intersects[0].object;
        while(intersectedObject.parent && intersectedObject.parent !== modelGroup && loadedObjects.indexOf(intersectedObject) === -1) {
            intersectedObject = intersectedObject.parent;
        }
        if (loadedObjects.indexOf(intersectedObject) !== -1) {
             selectObjectUI(intersectedObject);
        } else {
            selectObjectUI(null);
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
