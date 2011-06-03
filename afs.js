/**
* afsjs - Amiga Filesystem implementation in javascript
*
* Copyright 2011 by Dan Sutherland <djs@djs.org.uk>
*
* This code may be distributed, modified and used for any purpose provided
* this copyright notice is left intact and/or the author is credited in the
* documentation of any software or service using this code.
*/

function Afs() {
	const AFS_BlockSize = 512;
	const AFS_OFF_chksum = 0x14;

	FsTypes = {
		0: 'OFS',
		1: 'FFS',
		2: 'OFS+INTL',
		3: 'FFS+INTL',
		4: 'OFS+DIRCACHE+INTL',
		5: 'FFS+DIRCACHE+INTL',
	}

	this.isValid = false;

	this.load = function(img) {
		this.image = img;

		if (! this.processBootBlock()) {
			return false;
		}

		this.processRootBlock();
	}

	// checksums

	/**
	* Check standard checksum - this is the normal algoritm used by all
	* blocks except the boot block
	*/
	this.checkStandardChecksum = function(sect) {
		var view = new DataView(this.image, sect, AFS_BlockSize);

		var sum = 0;

		var oldSum = view.getUint32(OFF_chksum, false);

		view.setUint32(OFF_chksum, 0, false); // clear old checksum
	}

	/**
	* Calculate bootblock checksum (this is a different algorithm to the
	* standard one)
	*/
	this.checkBootblockChecksum = function() {
		var bbsize = AFS_BlockSize * 2; // TODO: hardfile support
		var bb = new DataView(this.image, 0, bbsize);

		var sum = 0;
		var oldSum = bb.getUint32(4, false);

		bb.setUint32(4, 0, false)
		for (var i = 0; i < bbsize; i += 4) {
			sum += bb.getUint32(i, false);
			if (sum > 0xffffffff) { // 32-bit overflow
				sum -= 0xffffffff;
			}
		}

		sum = ~sum;

		return (sum == oldSum);
	}

	/**
	* Check bootblock - make sure we have a valid DOS disk, check if bootable,
	* determine location of root block
	*/
	this.processBootBlock = function() {
		// is it a DOS disk?
		var bbView = new Int8Array(this.image);

		if (String.fromCharCode(bbView[0], bbView[1], bbView[2]) == 'DOS') {
			// yes, check type
			if (bbView[3] > 5) {
				// unknown AFS type
				return false;
			}

			this.isValid = true;

			this.fsType = bbView[3];
			this.bootable = this.checkBootblockChecksum();
		} else {
			return false;
		}

		return true;
	}

	/**
	* Process root block - verify checksum, get volume label and other info
	*/
	this.processRootBlock = function() {
		
	}
}
