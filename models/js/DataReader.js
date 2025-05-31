// js/DataReader.js
export class DataReader {
    constructor(arrayBuffer) {
        this.buffer = arrayBuffer;
        this.dataView = new DataView(arrayBuffer);
        this.offset = 0;
    }

    readBytes(length) {
        const value = new Uint8Array(this.buffer, this.offset, length);
        this.offset += length;
        return value;
    }

    readUint8() {
        const value = this.dataView.getUint8(this.offset);
        this.offset += 1;
        return value;
    }

    readUint16LE() {
        const value = this.dataView.getUint16(this.offset, true); // true for little-endian
        this.offset += 2;
        return value;
    }

    readInt16LE() {
        const value = this.dataView.getInt16(this.offset, true);
        this.offset += 2;
        return value;
    }

    readUint32LE() {
        const value = this.dataView.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readInt32LE() {
        const value = this.dataView.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readFloat32LE() {
        const value = this.dataView.getFloat32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readFloat32ArrayLE(count) {
        const arr = [];
        for (let i = 0; i < count; i++) {
            arr.push(this.readFloat32LE());
        }
        return arr;
    }

    readUint16ArrayLE(count) {
        const arr = [];
        for (let i = 0; i < count; i++) {
            arr.push(this.readUint16LE());
        }
        return arr;
    }
     readUint32ArrayLE(count) {
        const arr = [];
        for (let i = 0; i < count; i++) {
            arr.push(this.readUint32LE());
        }
        return arr;
    }


    readNullTerminatedString() {
        let str = "";
        let charCode;
        while ((charCode = this.readUint8()) !== 0x00) {
            str += String.fromCharCode(charCode);
        }
        try {
            return decodeURIComponent(escape(str)); // Handle UTF-8
        } catch (e) {
            return str; // Fallback for non-UTF8
        }
    }

    calculatePadding(length) {
        return (((length + 3) >> 2) << 2) - length; // Same as ((length + 3) // 4) * 4 - length
    }

    readLengthPrefixedString() {
        const length = this.readUint32LE();
        const bytes = this.readBytes(length);
        let str = "";
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(bytes[i]);
        }
        const padding = this.calculatePadding(length);
        this.skip(padding);
        try {
            return decodeURIComponent(escape(str)); // Handle UTF-8
        } catch (e) {
            return str; // Fallback for non-UTF8
        }
    }

    skip(bytes) {
        this.offset += bytes;
    }

    isEOF() {
        return this.offset >= this.buffer.byteLength;
    }

    getRemaining() {
        return this.buffer.byteLength - this.offset;
    }
}