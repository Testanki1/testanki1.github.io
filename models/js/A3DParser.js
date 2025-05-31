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
        // console.log(`[A3DMaterial name: ${this.name} color: ${this.color} diffuse map: ${this.diffuseMap}]`);
    }

    read3(reader) {
        this.name = reader.readLengthPrefixedString();
        this.color = reader.readFloat32ArrayLE(3);
        this.diffuseMap = reader.readLengthPrefixedString();
        // console.log(`[A3DMaterial name: ${this.name} color: ${this.color} diffuse map: ${this.diffuseMap}]`);
    }
}

class A3DVertexBuffer {
    constructor() {
        this.data = []; // array of arrays (e.g., [[x,y,z], [x,y,z]])
        this.bufferType = null;
    }

    read2(reader, vertexCount) { // Note: In python, vertexCount is passed, here too
        this.bufferType = reader.readUint32LE();
        if (!(this.bufferType in A3DVertexSize)) {
            throw new Error(`Unknown vertex buffer type: ${this.bufferType}`);
        }
        const vertexSize = A3DVertexSize[this.bufferType];
        for (let i = 0; i < vertexCount; i++) {
            this.data.push(reader.readFloat32ArrayLE(vertexSize));
        }
        // console.log(`[A3DVertexBuffer data: ${this.data.length} buffer type: ${this.bufferType}]`);
    }
}

class A3DSubmesh {
    constructor() {
        this.indices = [];
        this.smoothingGroups = []; // V2 only
        this.materialID = null;    // V2 only
        this.indexCount = 0;
    }

    read2(reader) {
        this.indexCount = reader.readUint32LE() * 3;
        this.indices = reader.readUint16ArrayLE(this.indexCount);
        this.smoothingGroups = reader.readUint32ArrayLE(this.indexCount / 3);
        this.materialID = reader.readUint16LE();
        // console.log(`[A3DSubmesh indices: ${this.indices.length} materialID: ${this.materialID}]`);
    }

    read3(reader) {
        this.indexCount = reader.readUint32LE();
        this.indices = reader.readUint16ArrayLE(this.indexCount);
        const padding = reader.calculatePadding(this.indexCount * 2); // Each index is 2 bytes
        reader.skip(padding);
        // console.log(`[A3DSubmesh indices: ${this.indices.length}]`);
    }
}

class A3DMesh {
    constructor() {
        this.name = ""; // V3 only
        this.bboxMax = null; // V3 only
        this.bboxMin = null; // V3 only
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
        // console.log(`[A3DMesh (v2) vertex buffers: ${this.vertexBuffers.length} submeshes: ${this.submeshes.length}]`);
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
            vertexBuffer.read2(reader, this.vertexCount); // read2 for vertex buffer is same for V2 and V3 A3D
            this.vertexBuffers.push(vertexBuffer);
        }

        this.submeshCount = reader.readUint32LE();
        for (let i = 0; i < this.submeshCount; i++) {
            const submesh = new A3DSubmesh();
            submesh.read3(reader);
            this.submeshes.push(submesh);
        }
        // console.log(`[A3DMesh name: ${this.name} vertex buffers: ${this.vertexBuffers.length} submeshes: ${this.submeshes.length}]`);
    }
}

class A3DTransform {
    constructor() {
        this.name = ""; // V3 only
        this.position = [0, 0, 0];
        this.rotation = [0, 0, 0, 0]; // Quaternion: x, y, z, w
        this.scale = [0, 0, 0];
    }

    read2(reader) {
        this.position = reader.readFloat32ArrayLE(3);
        this.rotation = reader.readFloat32ArrayLE(4);
        this.scale = reader.readFloat32ArrayLE(3);
        // console.log(`[A3DTransform (v2) pos: ${this.position}]`);
    }

    read3(reader) {
        this.name = reader.readLengthPrefixedString();
        this.position = reader.readFloat32ArrayLE(3);
        this.rotation = reader.readFloat32ArrayLE(4);
        this.scale = reader.readFloat32ArrayLE(3);
        // console.log(`[A3DTransform name: ${this.name} pos: ${this.position}]`);
    }
}

class A3DObject {
    constructor() {
        this.name = ""; // V2 only
        this.meshID = null;
        this.transformID = null;
        this.materialIDs = []; // V3 only
        this.materialCount = 0; // V3 only
    }

    read2(reader) {
        this.name = reader.readNullTerminatedString();
        [this.meshID, this.transformID] = [reader.readUint32LE(), reader.readUint32LE()];
        // console.log(`[A3DObject name: ${this.name} meshID: ${this.meshID}]`);
    }

    read3(reader) {
        [this.meshID, this.transformID, this.materialCount] = [reader.readUint32LE(), reader.readUint32LE(), reader.readUint32LE()];
        for (let i = 0; i < this.materialCount; i++) {
            this.materialIDs.push(reader.readInt32LE()); // materialID can be -1
        }
        // console.log(`[A3DObject (v3) meshID: ${this.meshID} materialIDs: ${this.materialIDs.length}]`);
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

        // Check signature
        const signature = reader.readBytes(4);
        for (let i = 0; i < 4; i++) {
            if (signature[i] !== A3D_SIGNATURE_BYTES[i]) {
                throw new Error(`Invalid A3D signature: ${signature}`);
            }
        }

        [this.version] = [reader.readUint16LE(), reader.readUint16LE()]; // major, minor
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
        return this; // For chaining or direct use
    }

    readRootBlock2(reader) {
        let signature = reader.readUint32LE();
        reader.skip(4); // length/unused
        if (signature !== A3D_ROOTBLOCK_SIGNATURE) {
            throw new Error(`Invalid root data block signature (V2): ${signature}`);
        }
        // console.log("Reading root block V2");
        this.readMaterialBlock2(reader);
        this.readMeshBlock2(reader);
        this.readTransformBlock2(reader);
        this.readObjectBlock2(reader);
    }

    readRootBlock3(reader) {
        let signature = reader.readUint32LE();
        let length = reader.readUint32LE();
        const blockStartOffset = reader.offset;

        if (signature !== A3D_ROOTBLOCK_SIGNATURE) {
            throw new Error(`Invalid root data block signature (V3): ${signature}`);
        }
        // console.log("Reading root block V3");
        this.readMaterialBlock3(reader);
        this.readMeshBlock3(reader);
        this.readTransformBlock3(reader);
        this.readObjectBlock3(reader);

        const bytesRead = reader.offset - blockStartOffset;
        const padding = length - bytesRead; // Correct padding calculation based on block length
        if (padding < 0) console.warn("Root block V3 padding underflow, length was: ", length, "bytesRead:", bytesRead);
        if (padding > 0) reader.skip(padding);

    }

    // --- Material Blocks ---
    readMaterialBlock2(reader) {
        let signature = reader.readUint32LE();
        reader.skip(4); // length/unused
        let materialCount = reader.readUint32LE();
        if (signature !== A3D_MATERIALBLOCK_SIGNATURE) {
            throw new Error(`Invalid material block signature (V2): ${signature}`);
        }
        // console.log(`Reading material block V2 with ${materialCount} materials`);
        for (let i = 0; i < materialCount; i++) {
            const material = new A3DMaterial();
            material.read2(reader);
            this.materials.push(material);
        }
    }

    readMaterialBlock3(reader) {
        let signature = reader.readUint32LE();
        let length = reader.readUint32LE();
        let materialCount = reader.readUint32LE();
        const blockStartOffset = reader.offset;

        if (signature !== A3D_MATERIALBLOCK_SIGNATURE) {
            throw new Error(`Invalid material block signature (V3): ${signature}`);
        }
        // console.log(`Reading material block V3 with ${materialCount} materials, length ${length}`);
        for (let i = 0; i < materialCount; i++) {
            const material = new A3DMaterial();
            material.read3(reader);
            this.materials.push(material);
        }
        const bytesRead = reader.offset - blockStartOffset;
        const padding = length - bytesRead;
         if (padding < 0) console.warn("Material block V3 padding underflow, length was: ", length, "bytesRead:", bytesRead);
        if (padding > 0) reader.skip(padding);
    }

    // --- Mesh Blocks ---
    readMeshBlock2(reader) {
        let signature = reader.readUint32LE();
        reader.skip(4); // length/unused
        let meshCount = reader.readUint32LE();
        if (signature !== A3D_MESHBLOCK_SIGNATURE) {
            throw new Error(`Invalid mesh block signature (V2): ${signature}`);
        }
        // console.log(`Reading mesh block V2 with ${meshCount} meshes`);
        for (let i = 0; i < meshCount; i++) {
            const mesh = new A3DMesh();
            mesh.read2(reader);
            this.meshes.push(mesh);
        }
    }

    readMeshBlock3(reader) {
        let signature = reader.readUint32LE();
        let length = reader.readUint32LE();
        let meshCount = reader.readUint32LE();
        const blockStartOffset = reader.offset;
        if (signature !== A3D_MESHBLOCK_SIGNATURE) {
            throw new Error(`Invalid mesh block signature (V3): ${signature}`);
        }
        // console.log(`Reading mesh block V3 with ${meshCount} meshes, length ${length}`);
        for (let i = 0; i < meshCount; i++) {
            const mesh = new A3DMesh();
            mesh.read3(reader);
            this.meshes.push(mesh);
        }
        const bytesRead = reader.offset - blockStartOffset;
        const padding = length - bytesRead;
        if (padding < 0) console.warn("Mesh block V3 padding underflow, length was: ", length, "bytesRead:", bytesRead);
        if (padding > 0) reader.skip(padding);
    }

    // --- Transform Blocks ---
    readTransformBlock2(reader) {
        let signature = reader.readUint32LE();
        reader.skip(4); // length/unused
        let transformCount = reader.readUint32LE();
        if (signature !== A3D_TRANSFORMBLOCK_SIGNATURE) {
            throw new Error(`Invalid transform block signature (V2): ${signature}`);
        }
        // console.log(`Reading transform block V2 with ${transformCount} transforms`);
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
        let length = reader.readUint32LE();
        let transformCount = reader.readUint32LE();
        const blockStartOffset = reader.offset;
        if (signature !== A3D_TRANSFORMBLOCK_SIGNATURE) {
            throw new Error(`Invalid transform block signature (V3): ${signature}`);
        }
        // console.log(`Reading transform block V3 with ${transformCount} transforms, length ${length}`);
        for (let i = 0; i < transformCount; i++) {
            const transform = new A3DTransform();
            transform.read3(reader);
            this.transforms.push(transform);
        }
        for (let i = 0; i < transformCount; i++) {
            this.transformParentIDs.push(reader.readInt32LE());
        }
        const bytesRead = reader.offset - blockStartOffset;
        const padding = length - bytesRead;
        if (padding < 0) console.warn("Transform block V3 padding underflow, length was: ", length, "bytesRead:", bytesRead);
        if (padding > 0) reader.skip(padding);
    }

    // --- Object Blocks ---
    readObjectBlock2(reader) {
        let signature = reader.readUint32LE();
        reader.skip(4); // length/unused
        let objectCount = reader.readUint32LE();
        if (signature !== A3D_OBJECTBLOCK_SIGNATURE) {
            throw new Error(`Invalid object block signature (V2): ${signature}`);
        }
        // console.log(`Reading object block V2 with ${objectCount} objects`);
        for (let i = 0; i < objectCount; i++) {
            const obj = new A3DObject();
            obj.read2(reader);
            this.objects.push(obj);
        }
    }

    readObjectBlock3(reader) {
        let signature = reader.readUint32LE();
        let length = reader.readUint32LE();
        let objectCount = reader.readUint32LE();
        const blockStartOffset = reader.offset;

        if (signature !== A3D_OBJECTBLOCK_SIGNATURE) {
            throw new Error(`Invalid object block signature (V3): ${signature}`);
        }
        // console.log(`Reading object block V3 with ${objectCount} objects, length ${length}`);
        for (let i = 0; i < objectCount; i++) {
            const obj = new A3DObject();
            obj.read3(reader);
            this.objects.push(obj);
        }
        const bytesRead = reader.offset - blockStartOffset;
        const padding = length - bytesRead;
        if (padding < 0) console.warn("Object block V3 padding underflow, length was: ", length, "bytesRead:", bytesRead);
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