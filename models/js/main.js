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
    renderer.domElement.addEventListener('touchstart', onTouchStart, false);
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
    // Textures are kept
}

function applyModelRotation() {
    if (modelGroup) {
        if (rotateModelCheckbox.checked) {
            modelGroup.rotation.x = -Math.PI / 2;
        } else {
            modelGroup.rotation.x = 0;
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

/**
 * NEW: This function now updates all materials in the scene based on currently loaded textures.
 * It's called every time a new texture is successfully loaded.
 */
function updateAllMaterials() {
    if (!modelGroup || modelGroup.children.length === 0) {
        return; // No model to update
    }

    console.log("Updating all materials with currently loaded textures...");

    modelGroup.traverse(child => {
        if (child.isMesh) {
            const a3dObj = child.userData.a3dObjectData;
            const a3dMatData = child.userData.a3dMaterialData;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            const a3dMats = Array.isArray(a3dMatData) ? a3dMatData : [a3dMatData];

            let textureApplied = false;

            // --- Strategy 1: Heuristic based on object name (overrides other methods) ---
            let heuristicTexture = null;
            if (a3dObj && a3dObj.name) {
                const objectNameLower = a3dObj.name.toLowerCase();
                if (objectNameLower.includes("hull") || objectNameLower.includes("turret")) {
                    heuristicTexture = loadedTextures['lightmap.webp'];
                } else if (objectNameLower.includes("track")) {
                    heuristicTexture = loadedTextures['tracks.webp'];
                } else if (objectNameLower.includes("wheel")) {
                    heuristicTexture = loadedTextures['wheels.webp'];
                }
            }

            if (heuristicTexture) {
                materials.forEach(mat => {
                    if (mat.map !== heuristicTexture) {
                        mat.map = heuristicTexture;
                        mat.needsUpdate = true;
                        textureApplied = true;
                    }
                });
            }

            // If no texture was applied by heuristics, try data-driven method
            if (!textureApplied && a3dMatData) {
                materials.forEach((mat, index) => {
                    const currentA3DMat = a3dMats[index] || (a3dMats.length === 1 ? a3dMats[0] : null);
                    if (currentA3DMat && currentA3DMat.diffuseMap) {
                        const diffuseMapName = currentA3DMat.diffuseMap.toLowerCase().split(/[\\/]/).pop();
                        const texture = loadedTextures[diffuseMapName];
                        if (texture && mat.map !== texture) {
                            mat.map = texture;
                            mat.needsUpdate = true;
                        }
                    }
                });
            }
        }
    });
}


function handleTextureFiles(files) {
    const textureLoader = new THREE.TextureLoader();

    for (const file of files) {
        const textureKey = file.name.toLowerCase();
        
        // If a texture with the same name exists, dispose of the old one first
        if (loadedTextures[textureKey]) {
            loadedTextures[textureKey].dispose();
        }

        const objectURL = URL.createObjectURL(file);
        textureLoader.load(
            objectURL,
            (texture) => {
                texture.name = file.name;
                // IMPORTANT: Since we flip UVs manually (1.0 - v), we must tell the loader not to flip the image.
                texture.flipY = false;
                
                loadedTextures[textureKey] = texture;
                console.log(`Loaded texture: ${file.name}`);
                URL.revokeObjectURL(objectURL);

                // On every successful load, trigger a full material update
                updateAllMaterials();
            },
            undefined, // onProgress callback
            (error) => {
                console.error(`Error loading texture ${file.name}:`, error);
                URL.revokeObjectURL(objectURL);
            }
        );
    }
}


function buildThreeJSModel(a3dData) {
    const originalA3dMaterials = [];
    const threeMaterials = a3dData.materials.map(matData => {
        const params = {
            name: matData.name,
            color: new THREE.Color().fromArray(matData.color),
            roughness: 0.8,
            metalness: 0.1,
        };
        // At creation time, try to find an already-loaded texture
        if (matData.diffuseMap) {
            const diffuseMapName = matData.diffuseMap.toLowerCase().split(/[\\/]/).pop();
            if (loadedTextures[diffuseMapName]) {
                params.map = loadedTextures[diffuseMapName];
            }
        }
        const material = new THREE.MeshStandardMaterial(params);
        originalA3dMaterials.push(matData);
        return material;
    });

    const threeMeshesData = a3dData.meshes.map(meshData => {
        const geometry = new THREE.BufferGeometry();
        let positions = [], uvs = [], normals = [];

        meshData.vertexBuffers.forEach(vb => {
            if (vb.bufferType === A3D_VERTEXTYPE_COORDINATE) {
                vb.data.forEach(v => positions.push(...v));
            } else if (vb.bufferType === A3D_VERTEXTYPE_UV1) {
                vb.data.forEach(uv => uvs.push(uv[0], 1.0 - uv[1])); // Flip V-coordinate
            } else if (vb.bufferType === A3D_VERTEXTYPE_NORMAL1) {
                vb.data.forEach(n => normals.push(...n));
            }
        });

        if (positions.length > 0) geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (uvs.length > 0) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        if (normals.length > 0) {
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        } else if (positions.length > 0) {
            geometry.computeVertexNormals();
        }

        let allIndices = [];
        if (meshData.submeshes.length > 0) {
            if (a3dData.version === 2) {
                meshData.submeshes.forEach((sm) => {
                    geometry.addGroup(allIndices.length, sm.indices.length, sm.materialID !== null ? sm.materialID : 0);
                    allIndices.push(...sm.indices);
                });
            } else {
                 meshData.submeshes.forEach(sm => allIndices.push(...sm.indices));
            }
        }
        if (allIndices.length > 0) geometry.setIndex(allIndices);

        return { geometry, a3dMeshData: meshData };
    });

    const objectMap = {};

    a3dData.objects.forEach((objData, index) => {
        const meshInfo = threeMeshesData[objData.meshID];
        if (!meshInfo) return;

        let currentObjectMaterials = [];
        let currentObjectA3dMaterialData = [];

        if (a3dData.version === 2) {
            const usedMaterialIndexes = new Set(meshInfo.a3dMeshData.submeshes.map(sm => sm.materialID).filter(id => id !== null));
            if (usedMaterialIndexes.size > 0) {
                 usedMaterialIndexes.forEach(idx => {
                    currentObjectMaterials.push(threeMaterials[idx]);
                    currentObjectA3dMaterialData.push(originalA3dMaterials[idx]);
                 });
            } else if (threeMaterials.length > 0) {
                 currentObjectMaterials.push(threeMaterials[0]);
                 currentObjectA3dMaterialData.push(originalA3dMaterials[0]);
            } else {
                currentObjectMaterials.push(new THREE.MeshStandardMaterial({color: 0xdddddd}));
            }
        } else { // V3
            objData.materialIDs.forEach(matID => {
                if (matID >= 0 && matID < threeMaterials.length) {
                    currentObjectMaterials.push(threeMaterials[matID]);
                    currentObjectA3dMaterialData.push(originalA3dMaterials[matID]);
                }
            });
            if (currentObjectMaterials.length === 0) {
                 const fallbackMat = threeMaterials.length > 0 ? threeMaterials[0] : new THREE.MeshStandardMaterial({color: 0xcccccc});
                 const fallbackA3dData = threeMaterials.length > 0 ? originalA3dMaterials[0] : null;
                 currentObjectMaterials.push(fallbackMat);
                 if(fallbackA3dData) currentObjectA3dMaterialData.push(fallbackA3dData);
            }
        }

        const threeMesh = new THREE.Mesh(meshInfo.geometry, currentObjectMaterials.length > 1 ? currentObjectMaterials : currentObjectMaterials[0]);
        threeMesh.name = objData.name || meshInfo.a3dMeshData.name || `Object_${index}`;

        const transformData = a3dData.transforms[objData.transformID];
        if (transformData) {
            threeMesh.position.fromArray(transformData.position);
            threeMesh.quaternion.fromArray(transformData.rotation);
            threeMesh.scale.fromArray(transformData.scale);
            if (transformData.scale.every(s => s === 0)) {
                threeMesh.scale.set(1, 1, 1);
            }
        }

        threeMesh.userData.a3dObjectData = objData;
        threeMesh.userData.a3dMaterialData = currentObjectA3dMaterialData.length > 1 ? currentObjectA3dMaterialData : currentObjectA3dMaterialData[0];

        loadedObjects.push(threeMesh);
        objectMap[index] = threeMesh;
        addToListUI(threeMesh, index);
    });

    // Setup parenting
    loadedObjects.forEach((obj, originalIndex) => {
        const parentID = a3dData.transformParentIDs[a3dData.objects[originalIndex].transformID];
        let actualParentId = -1;
        if (parentID !== -1) {
             // Find object that uses this transform
            for (let i = 0; i < a3dData.objects.length; i++) {
                if (a3dData.objects[i].transformID === parentID) {
                    if (objectMap[i] && objectMap[i] !== obj) {
                        objectMap[i].add(obj);
                    }
                    return; // Parent found and assigned, exit forEach loop for this obj
                }
            }
        }
        // If no parent found or parentID is -1, add to model group
        modelGroup.add(obj);
    });

    // Final material update pass after building the whole hierarchy
    updateAllMaterials();
    applyModelRotation();
    
    // Fit camera to model
    if (loadedObjects.length > 0) {
        const box = new THREE.Box3().setFromObject(modelGroup);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        controls.reset();
        const maxSize = Math.max(size.x, size.y, size.z);
        const fitHeightDistance = maxSize / (2 * Math.atan(Math.PI * camera.fov / 360));
        const fitWidthDistance = fitHeightDistance / camera.aspect;
        const distance = 1.2 * Math.max(fitHeightDistance, fitWidthDistance, 10);
        const direction = controls.object.position.clone().sub(center).normalize().multiplyScalar(distance);
        controls.object.position.copy(center).add(direction);
        controls.target.copy(center);
        controls.update();
    }
}

// --- UI and Interaction Functions (Unchanged) ---

function addToListUI(object, id) {
    const listItem = document.createElement('li');
    listItem.textContent = object.name || `Unnamed Object ${id}`;
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
                materials.forEach(m => m.emissive.setHex(0x000000));
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
                materials.forEach(m => m.emissive.setHex(0x555500));
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
                (Array.isArray(child.material) ? child.material : [child.material]).forEach(mat => {
                    if (mat.map) mat.map.dispose();
                    mat.dispose();
                });
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
        while(intersectedObject.parent && intersectedObject.parent !== modelGroup && !intersectedObject.userData.a3dObjectData) {
            intersectedObject = intersectedObject.parent;
        }
        if (loadedObjects.includes(intersectedObject)) {
             selectObjectUI(intersectedObject);
        } else {
            selectObjectUI(null);
        }
    } else {
        selectObjectUI(null);
    }
}

document.getElementById('a3dFile').addEventListener('change', (event) => {
    if (event.target.files.length > 0) handleA3DFile(event.target.files[0]);
});
document.getElementById('textureFiles').addEventListener('change', (event) => {
    if (event.target.files.length > 0) handleTextureFiles(event.target.files);
});
deleteButton.addEventListener('click', deleteSelected);

initThreeJS();
