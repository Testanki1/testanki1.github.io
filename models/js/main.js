// js/main.js
import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { A3D, A3D_VERTEXTYPE_COORDINATE, A3D_VERTEXTYPE_UV1, A3D_VERTEXTYPE_NORMAL1 } from './A3DParser.js';

let scene, camera, renderer, controls;
let modelGroup; 
let loadedObjects = []; 
let selectedObject = null;
let loadedTextures = {}; // 全局纹理缓存
let lastA3DData = null; // 缓存最后一次解析的A3D数据

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
        // 只处理 Three.js 对象的清理，不清除 a3dData 或 textures
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
}

function applyModelRotation() {
    if (modelGroup) {
        modelGroup.rotation.x = rotateModelCheckbox.checked ? -Math.PI / 2 : 0;
    }
}

function handleA3DFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            // 解析A3D数据并缓存
            lastA3DData = new A3D().parse(event.target.result);
            console.log("Parsed and cached A3D Data:", lastA3DData);
            // 基于当前缓存的A3D数据和已加载的纹理，重建整个模型
            rebuildModel();
        } catch (error) {
            console.error("Error parsing A3D file:", error);
            alert(`Error parsing A3D: ${error.message}`);
            lastA3DData = null; // 解析失败，清空缓存
        }
    };
    reader.readAsArrayBuffer(file);
}

function handleTextureFiles(files) {
    const textureLoader = new THREE.TextureLoader();
    let filesToLoad = files.length;
    if (filesToLoad === 0) return;

    const onTextureLoaded = () => {
        filesToLoad--;
        // 当所有新上传的纹理都处理完毕（无论成功或失败）
        if (filesToLoad === 0) {
            console.log("Texture batch processed. Rebuilding model...");
            // 如果已经有模型数据，就重建模型
            if (lastA3DData) {
                rebuildModel();
            }
        }
    };

    for (const file of files) {
        const textureKey = file.name.toLowerCase();
        if (loadedTextures[textureKey]) {
            loadedTextures[textureKey].dispose();
        }
        const objectURL = URL.createObjectURL(file);
        textureLoader.load(
            objectURL,
            (texture) => {
                texture.name = file.name;
                texture.flipY = false; // UVs in parser are already flipped (v = 1.0 - v)
                loadedTextures[textureKey] = texture;
                console.log(`Loaded texture: ${file.name}`);
                URL.revokeObjectURL(objectURL);
                onTextureLoaded();
            },
            undefined,
            (error) => {
                console.error(`Error loading texture ${file.name}:`, error);
                URL.revokeObjectURL(objectURL);
                onTextureLoaded();
            }
        );
    }
}

/**
 * 核心函数：使用缓存的 A3D 数据和当前所有已加载的纹理，从头开始构建或重建整个 Three.js 场景。
 */
function rebuildModel() {
    if (!lastA3DData) {
        console.warn("rebuildModel called but no A3D data is available.");
        return;
    }

    const a3dData = lastA3DData;

    // 1. 清理旧的 Three.js 场景对象
    clearScene();

    // 2. 创建材质 (每次都重新创建)
    const threeMaterials = a3dData.materials.map(matData => {
        const params = {
            name: matData.name,
            color: new THREE.Color().fromArray(matData.color),
            roughness: 0.8,
            metalness: 0.1,
        };
        // 尝试从全局纹理缓存中查找纹理
        if (matData.diffuseMap) {
            const diffuseMapName = matData.diffuseMap.toLowerCase().split(/[\\/]/).pop();
            if (loadedTextures[diffuseMapName]) {
                params.map = loadedTextures[diffuseMapName];
            }
        }
        return new THREE.MeshStandardMaterial(params);
    });

    // 3. 创建几何体和网格 (这部分可以优化，但为保证可靠性，暂时也重新创建)
    // 注意：理想情况下，几何体可以被缓存，但材质必须重新创建和分配。
    // 为简单起见，我们这里全部重建。
    const objectMap = {};
    a3dData.objects.forEach((objData, index) => {
        const meshData = a3dData.meshes[objData.meshID];
        if (!meshData) return;

        // 创建几何体
        const geometry = new THREE.BufferGeometry();
        let positions = [], uvs = [], normals = [];
        meshData.vertexBuffers.forEach(vb => {
            if (vb.bufferType === A3D_VERTEXTYPE_COORDINATE) vb.data.forEach(v => positions.push(...v));
            else if (vb.bufferType === A3D_VERTEXTYPE_UV1) vb.data.forEach(uv => uvs.push(uv[0], 1.0 - uv[1]));
            else if (vb.bufferType === A3D_VERTEXTYPE_NORMAL1) vb.data.forEach(n => normals.push(...n));
        });
        if (positions.length > 0) geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (uvs.length > 0) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        if (normals.length > 0) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        else geometry.computeVertexNormals();

        let allIndices = [];
        if (a3dData.version === 2) {
             meshData.submeshes.forEach(sm => {
                geometry.addGroup(allIndices.length, sm.indices.length, sm.materialID !== null ? sm.materialID : 0);
                allIndices.push(...sm.indices);
            });
        } else {
             meshData.submeshes.forEach(sm => allIndices.push(...sm.indices));
        }
        if (allIndices.length > 0) geometry.setIndex(allIndices);

        // 分配材质
        let currentObjectMaterials = [];
        if (a3dData.version === 2) {
            const matIndices = new Set(meshData.submeshes.map(sm => sm.materialID).filter(id => id !== null));
            if (matIndices.size > 0) matIndices.forEach(idx => currentObjectMaterials.push(threeMaterials[idx]));
            else if (threeMaterials.length > 0) currentObjectMaterials.push(threeMaterials[0]);
        } else { // V3
            objData.materialIDs.forEach(matID => {
                if (matID >= 0 && matID < threeMaterials.length) currentObjectMaterials.push(threeMaterials[matID]);
            });
            if (currentObjectMaterials.length === 0 && threeMaterials.length > 0) currentObjectMaterials.push(threeMaterials[0]);
        }
        if (currentObjectMaterials.length === 0) {
            currentObjectMaterials.push(new THREE.MeshStandardMaterial({ color: 0xcccccc }));
        }

        const meshMaterial = currentObjectMaterials.length > 1 ? currentObjectMaterials : currentObjectMaterials[0];
        const threeMesh = new THREE.Mesh(geometry, meshMaterial);

        // 应用启发式纹理（如果名称匹配）
        const objName = objData.name || meshData.name || `Object_${index}`;
        threeMesh.name = objName;
        const objectNameLower = objName.toLowerCase();
        let heuristicTexture = null;
        if (objectNameLower.includes("hull") || objectNameLower.includes("turret")) heuristicTexture = loadedTextures['lightmap.webp'];
        else if (objectNameLower.includes("track")) heuristicTexture = loadedTextures['tracks.webp'];
        else if (objectNameLower.includes("wheel")) heuristicTexture = loadedTextures['wheels.webp'];
        
        if (heuristicTexture) {
            (Array.isArray(threeMesh.material) ? threeMesh.material : [threeMesh.material]).forEach(mat => {
                mat.map = heuristicTexture;
                // 注意：由于是全新创建的材质，这里不需要 needsUpdate = true
            });
        }

        // 设置变换
        const transformData = a3dData.transforms[objData.transformID];
        if (transformData) {
            threeMesh.position.fromArray(transformData.position);
            threeMesh.quaternion.fromArray(transformData.rotation);
            threeMesh.scale.fromArray(transformData.scale);
            if (transformData.scale.every(s => s === 0)) threeMesh.scale.set(1, 1, 1);
        }

        loadedObjects.push(threeMesh);
        objectMap[index] = threeMesh;
        addToListUI(threeMesh, index);
    });

    // 4. 设置父子关系
    loadedObjects.forEach((obj, originalIndex) => {
        const parentID = a3dData.transformParentIDs[a3dData.objects[originalIndex].transformID];
        if (parentID !== -1) {
            for (let i = 0; i < a3dData.objects.length; i++) {
                if (a3dData.objects[i].transformID === parentID) {
                    if (objectMap[i] && objectMap[i] !== obj) {
                        objectMap[i].add(obj);
                        return;
                    }
                }
            }
        }
        modelGroup.add(obj);
    });

    // 5. 应用旋转并重置相机
    applyModelRotation();

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

// --- UI and Interaction Functions (Unchanged from previous versions) ---

function addToListUI(object, id) {
    const listItem = document.createElement('li');
    listItem.textContent = object.name || `Unnamed Object ${id}`;
    listItem.dataset.objectId = object.uuid;
    listItem.addEventListener('click', () => selectObjectUI(object));
    objectListUI.appendChild(listItem);
}

function selectObjectUI(object) {
    if (selectedObject) {
        selectedObject.traverse(child => {
            if (child.isMesh) (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => m.emissive.setHex(0x000000));
        });
        const oldLi = objectListUI.querySelector(`[data-object-id="${selectedObject.uuid}"]`);
        if (oldLi) oldLi.classList.remove('selected');
    }
    selectedObject = object;
    if (selectedObject) {
        selectedObject.traverse(child => {
             if (child.isMesh) (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => m.emissive.setHex(0x555500));
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
            if (child.material) (Array.isArray(child.material) ? child.material : [child.material]).forEach(mat => {
                if (mat.map) mat.map.dispose();
                mat.dispose();
            });
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
    if (touchHandled) { touchHandled = false; return; }
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
        while(intersectedObject.parent && intersectedObject.parent !== modelGroup && !loadedObjects.includes(intersectedObject)) {
            intersectedObject = intersectedObject.parent;
        }
        selectObjectUI(loadedObjects.includes(intersectedObject) ? intersectedObject : null);
    } else {
        selectObjectUI(null);
    }
}

// Event Listeners
document.getElementById('a3dFile').addEventListener('change', (event) => {
    if (event.target.files.length > 0) handleA3DFile(event.target.files[0]);
});
document.getElementById('textureFiles').addEventListener('change', (event) => {
    if (event.target.files.length > 0) handleTextureFiles(event.target.files);
});
deleteButton.addEventListener('click', deleteSelected);

initThreeJS();
