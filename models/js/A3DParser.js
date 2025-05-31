// js/A3DParser.js
import { DataReader } from './DataReader.js';

// A3D Constants
const A3D_SIGNATURE_BYTES = new Uint8Array([0x41, 0x33, 0x44, 0x00]); // "A3D\0"
const A3D_ROOTBLOCK_SIGNATURE = 1;
const A3D_MATERIALBLOCK_SIGNATURE = 4;
const A3D_MESHBLOCK_SIGNATURE = 2;
const A3D_TRANSFORMBLOCK_SIGNATURE = 3;
const A3D_OBJECTBLOCK_SIGNATURE = 5;

// Vertex Types
const A3D_VERTEXTYPE_COORDINATE = 1;
const A3D_VERTEXTYPE_UV1 = 2;
const A3D_VERTEXTYPE_NORMAL1 = 3;
const A3D_VERTEXTYPE_UV2 = 4;
const A3D_VERTEXTYPE_COLOR = 5;
const A3D_VERTEXTYPE_NORMAL2 = 6;

const A3DVertexSize = {
    [A3D_VERTEXTYPE_COORDINATE]: 3,
    [A3D_VERTEXTYPE_UV1]: 2,
    [A3D_VERTEXTYPE_NORMAL1]: 3,
    [A3D_VERTEXTYPE_UV2]: 2,
    [A3D_VERTEXTYPE_COLOR]: 4,
    [A3D_VERTEXTYPE_NORMAL2]: 3
};

class A3DMaterial {
    constructor() {
        this.name = "";
        this.color = [0.0, 0.0, 0.0]; // r, g, b
        this.diffuseMap = "";
    }

    read2(reader) {
        this.name = reader.readNullTerminatedString();
        this.color = reader.readFloat32ArrayLE(3);
        this.diffuseMap = reader.readNullTerminatedString();
    }

    read3(reader) {
        this.name = reader.readLengthPrefixedString();
        this.color = reader.readFloat32ArrayLE(3);
        this.diffuseMap = reader.readLengthPrefixedString();
    }
}

class A3DVertexBuffer {
    constructor() {
        this.data = []; 
        this.bufferType = null;
    }

    read2(reader, vertexCount) { 
        this.bufferType = reader.readUint32LE();
        if (!(this.bufferType in A3DVertexSize)) {
            throw new Error(`Unknown vertex buffer type: ${this.bufferType}`);
        }
        const vertexSize = A3DVertexSize[this.bufferType];
        for (let i = 0; i < vertexCount; i++) {
            this.data.push(reader.readFloat32ArrayLE(vertexSize));
        }
    }
}

class A3DSubmesh {
    constructor() {
        this.indices = [];
        this.smoothingGroups = []; 
        this.materialID = null;    
        this.indexCount = 0;
    }

    read2(reader) {
        this.indexCount = reader.readUint32LE() * 3;
        this.indices = reader.readUint16ArrayLE(this.indexCount);
        this.smoothingGroups = reader.readUint32ArrayLE(this.indexCount / 3);
        this.materialID = reader.readUint16LE();
    }

    read3(reader) {
        this.indexCount = reader.readUint32LE();
        this.indices = reader.readUint16ArrayLE(this.indexCount);
        const padding = reader.calculatePadding(this.indexCount * 2); 
        reader.skip(padding);
    }
}

class A3DMesh {
    constructor() {
        this.name = ""; 
        this.bboxMax = null; 
        this.bboxMin = null; 
        this.vertexBuffers = [];
        this.submeshes = [];
        this.vertexCount = 0;
        this.vertexBufferCount = 0;
        this.submeshCount = 0;
    }

    read2(reader) {
        this.vertexCount = reader.readUint32LE();
        this.vertexBufferCount = reader.readUint32LE();
        for (let i = 0; i < this.vertexBufferCount; i++) {
            const vertexBuffer = new A3DVertexBuffer();
            vertexBuffer.read2(reader, this.vertexCount);
            this.vertexBuffers.push(vertexBuffer);
        }

        this.submeshCount = reader.readUint32LE();
        for (let i = 0; i < this.submeshCount; i++) {
            const submesh = new A3DSubmesh();
            submesh.read2(reader);
            this.submeshes.push(submesh);
        }
    }

    read3(reader) {
        this.name = reader.readLengthPrefixedString();
        this.bboxMax = reader.readFloat32ArrayLE(3);
        this.bboxMin = reader.readFloat32ArrayLE(3);
        reader.skip(4); // Unknown float

        this.vertexCount = reader.readUint32LE();
        this.vertexBufferCount = reader.readUint32LE();
        for (let i = 0; i < this.vertexBufferCount; i++) {
            const vertexBuffer = new A3DVertexBuffer();
            vertexBuffer.read2(reader, this.vertexCount); 
            this.vertexBuffers.push(vertexBuffer);
        }

        this.submeshCount = reader.readUint32LE();
        for (let i = 0; i < this.submeshCount; i++) {
            const submesh = new A3DSubmesh();
            submesh.read3(reader);
            this.submeshes.push(submesh);
        }
    }
}

class A3DTransform {
    constructor() {
        this.name = ""; 
        this.position = [0, 0, 0];
        this.rotation = [0, 0, 0, 0]; 
        this.scale = [0, 0, 0];
    }

    read2(reader) {
        this.position = reader.readFloat32ArrayLE(3);
        this.rotation = reader.readFloat32ArrayLE(4);
        this.scale = reader.readFloat32ArrayLE(3);
    }

    read3(reader) {
        this.name = reader.readLengthPrefixedString();
        this.position = reader.readFloat32ArrayLE(3);
        this.rotation = reader.readFloat32ArrayLE(4);
        this.scale = reader.readFloat32ArrayLE(3);
    }
}

class A3DObject {
    constructor() {
        this.name = ""; 
        this.meshID = null;
        this.transformID = null;
        this.materialIDs = []; 
        this.materialCount = 0; 
    }

    read2(reader) {
        this.name = reader.readNullTerminatedString();
        [this.meshID, this.transformID] = [reader.readUint32LE(), reader.readUint32LE()];
    }

    read3(reader) {
        [this.meshID, this.transformID, this.materialCount] = [reader.readUint32LE(), reader.readUint32LE(), reader.readUint32LE()];
        for (let i = 0; i < this.materialCount; i++) {
            this.materialIDs.push(reader.readInt32LE()); 
        }
    }
}


export class A3D {
    constructor() {
        this.version = 0;
        this.materials = [];
        this.meshes = [];
        this.transforms = [];
        this.transformParentIDs = [];
        this.objects = [];
    }

    parse(arrayBuffer) {
        const reader = new DataReader(arrayBuffer);

        const signatureBytes = reader.readBytes(4);
        for (let i = 0; i < 4; i++) {
            if (signatureBytes[i] !== A3D_SIGNATURE_BYTES[i]) {
                throw new Error(`Invalid A3D signature: ${signatureBytes}`);
            }
        }

        [this.version] = [reader.readUint16LE(), reader.readUint16LE()]; 
        // console.log(`Reading A3D version ${this.version}`);

        if (this.version === 1) {
            throw new Error("Version 1 A3D files are not supported yet");
        } else if (this.version === 2) {
            this.readRootBlock2(reader);
        } else if (this.version === 3) {
            this.readRootBlock3(reader);
        } else {
            throw new Error(`Unsupported A3D version: ${this.version}`);
        }
        return this;
    }

    readRootBlock2(reader) {
        let signature = reader.readUint32LE();
        reader.skip(4); 
        if (signature !== A3D_ROOTBLOCK_SIGNATURE) {
            throw new Error(`Invalid root data block signature (V2): ${signature}`);
        }
        this.readMaterialBlock2(reader);
        this.readMeshBlock2(reader);
        this.readTransformBlock2(reader);
        this.readObjectBlock2(reader);
    }

    readRootBlock3(reader) {
        let signature = reader.readUint32LE();
        let length = reader.readUint32LE();
        const blockStartOffset = reader.offset; // Offset after signature and length

        if (signature !== A3D_ROOTBLOCK_SIGNATURE) {
            throw new Error(`Invalid root data block signature (V3): ${signature}`);
        }
        this.readMaterialBlock3(reader);
        this.readMeshBlock3(reader);
        this.readTransformBlock3(reader);
        this.readObjectBlock3(reader);

        const bytesReadForContent = reader.offset - blockStartOffset;
        const padding = length - bytesReadForContent; 
        if (padding < 0) console.warn(`Root block V3 padding underflow. Declared length: ${length}, Bytes read for content: ${bytesReadForContent}`);
        if (padding > 0) reader.skip(padding);
    }

    // --- Material Blocks ---
    readMaterialBlock2(reader) {
        let signature = reader.readUint32LE();
        reader.skip(4); 
        let materialCount = reader.readUint32LE();
        if (signature !== A3D_MATERIALBLOCK_SIGNATURE) {
            throw new Error(`Invalid material block signature (V2): ${signature}`);
        }
        for (let i = 0; i < materialCount; i++) {
            const material = new A3DMaterial();
            material.read2(reader);
            this.materials.push(material);
        }
    }

    readMaterialBlock3(reader) {
        let signature = reader.readUint32LE();
        let length = reader.readUint32LE(); // Length of (count_field + items_data + padding)
        let materialCount = reader.readUint32LE();
        const itemsStartOffset = reader.offset; // Offset at the start of the first material item

        if (signature !== A3D_MATERIALBLOCK_SIGNATURE) {
            throw new Error(`Invalid material block signature (V3): ${signature}`);
        }
        for (let i = 0; i < materialCount; i++) {
            const material = new A3DMaterial();
            material.read3(reader);
            this.materials.push(material);
        }
        const bytesReadForItems = reader.offset - itemsStartOffset;
        const totalPayloadSizeCoveredByLengthField = 4 /*for count field*/ + bytesReadForItems;
        const padding = length - totalPayloadSizeCoveredByLengthField;

        if (padding < 0) {
            console.warn(`Material block V3 padding underflow. Declared length: ${length}, Calculated payload (count + items): ${totalPayloadSizeCoveredByLengthField}. Reader offset: ${reader.offset}`);
        }
        if (padding > 0) reader.skip(padding);
    }

    // --- Mesh Blocks ---
    readMeshBlock2(reader) {
        let signature = reader.readUint32LE();
        reader.skip(4); 
        let meshCount = reader.readUint32LE();
        if (signature !== A3D_MESHBLOCK_SIGNATURE) {
            throw new Error(`Invalid mesh block signature (V2): ${signature}`);
        }
        for (let i = 0; i < meshCount; i++) {
            const mesh = new A3DMesh();
            mesh.read2(reader);
            this.meshes.push(mesh);
        }
    }

    readMeshBlock3(reader) {
        let signature = reader.readUint32LE();
        let length = reader.readUint32LE(); // Length of (count_field + items_data + padding)
        let meshCount = reader.readUint32LE();
        const itemsStartOffset = reader.offset; // Offset at the start of the first mesh item

        if (signature !== A3D_MESHBLOCK_SIGNATURE) {
            throw new Error(`Invalid mesh block signature (V3): ${signature}`);
        }
        for (let i = 0; i < meshCount; i++) {
            const mesh = new A3DMesh();
            mesh.read3(reader);
            this.meshes.push(mesh);
        }
        const bytesReadForItems = reader.offset - itemsStartOffset;
        const totalPayloadSizeCoveredByLengthField = 4 /*for count field*/ + bytesReadForItems;
        const padding = length - totalPayloadSizeCoveredByLengthField;
        
        if (padding < 0) {
            console.warn(`Mesh block V3 padding underflow. Declared length: ${length}, Calculated payload (count + items): ${totalPayloadSizeCoveredByLengthField}. Reader offset: ${reader.offset}`);
        }
        if (padding > 0) reader.skip(padding);
    }

    // --- Transform Blocks ---
    readTransformBlock2(reader) {
        let signature = reader.readUint32LE();
        reader.skip(4); 
        let transformCount = reader.readUint32LE();
        if (signature !== A3D_TRANSFORMBLOCK_SIGNATURE) {
            throw new Error(`Invalid transform block signature (V2): ${signature}`);
        }
        for (let i = 0; i < transformCount; i++) {
            const transform = new A3DTransform();
            transform.read2(reader);
            this.transforms.push(transform);
        }
        for (let i = 0; i < transformCount; i++) {
            this.transformParentIDs.push(reader.readInt32LE());
        }
    }

    readTransformBlock3(reader) {
        let signature = reader.readUint32LE();
        let length = reader.readUint32LE(); // Length of (count_field + items_data + parent_ids_data + padding)
        let transformCount = reader.readUint32LE();
        const itemsStartOffset = reader.offset; // Offset at the start of the first transform item

        if (signature !== A3D_TRANSFORMBLOCK_SIGNATURE) {
            throw new Error(`Invalid transform block signature (V3): ${signature}`);
        }
        for (let i = 0; i < transformCount; i++) {
            const transform = new A3DTransform();
            transform.read3(reader);
            this.transforms.push(transform);
        }
        for (let i = 0; i < transformCount; i++) {
            this.transformParentIDs.push(reader.readInt32LE());
        }
        // The itemsStartOffset was for transform items. Now account for parent IDs too.
        // The 'count' field (transformCount) applies to both transforms and parentIDs.
        // Length = 4 (for count) + (data for N transforms) + (data for N parentIDs) + padding
        const bytesReadForItemsAndParentIDs = reader.offset - itemsStartOffset; // This covers N transforms + N parentIDs
        const totalPayloadSizeCoveredByLengthField = 4 /*for count field*/ + bytesReadForItemsAndParentIDs;
        const padding = length - totalPayloadSizeCoveredByLengthField;

        if (padding < 0) {
             console.warn(`Transform block V3 padding underflow. Declared length: ${length}, Calculated payload (count + items + parentIDs): ${totalPayloadSizeCoveredByLengthField}. Reader offset: ${reader.offset}`);
        }
        if (padding > 0) reader.skip(padding);
    }

    // --- Object Blocks ---
    readObjectBlock2(reader) {
        let signature = reader.readUint32LE();
        reader.skip(4); 
        let objectCount = reader.readUint32LE();
        if (signature !== A3D_OBJECTBLOCK_SIGNATURE) {
            throw new Error(`Invalid object block signature (V2): ${signature}`);
        }
        for (let i = 0; i < objectCount; i++) {
            const obj = new A3DObject();
            obj.read2(reader);
            this.objects.push(obj);
        }
    }

    readObjectBlock3(reader) {
        let signature = reader.readUint32LE();
        let length = reader.readUint32LE(); // Length of (count_field + items_data + padding)
        let objectCount = reader.readUint32LE();
        const itemsStartOffset = reader.offset; // Offset at the start of the first object item

        if (signature !== A3D_OBJECTBLOCK_SIGNATURE) {
            throw new Error(`Invalid object block signature (V3): ${signature}`);
        }
        for (let i = 0; i < objectCount; i++) {
            const obj = new A3DObject();
            obj.read3(reader);
            this.objects.push(obj);
        }
        const bytesReadForItems = reader.offset - itemsStartOffset;
        const totalPayloadSizeCoveredByLengthField = 4 /*for count field*/ + bytesReadForItems;
        const padding = length - totalPayloadSizeCoveredByLengthField;

        if (padding < 0) {
            console.warn(`Object block V3 padding underflow. Declared length: ${length}, Calculated payload (count + items): ${totalPayloadSizeCoveredByLengthField}. Reader offset: ${reader.offset}`);
        }
        if (padding > 0) reader.skip(padding);
    }
}

// Export constants needed by main.js for geometry assembly
export {
    A3D_VERTEXTYPE_COORDINATE,
    A3D_VERTEXTYPE_UV1,
    A3D_VERTEXTYPE_NORMAL1,
    A3D_VERTEXTYPE_UV2,
    A3D_VERTEXTYPE_COLOR,
    A3D_VERTEXTYPE_NORMAL2
};
