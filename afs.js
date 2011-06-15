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
	// primary types
	const AFS_T_HEADER = 0x02;
	const AFS_T_LIST = 0x10;

	// secondary types
	const AFS_ST_ROOT = 0x01;
	const AFS_ST_USERDIR = 0x02;
	const AFS_ST_SOFTLINK = 0x03;
	const AFS_ST_LINKDIR = 0x04;
	const AFS_ST_FILE = 0xfffffffd; // -3, but we're using usigned ints
	const AFS_ST_LINKFILE = 0xfffffffc; // -4

	const AFS_BSIZE = 0x200;
	const AFS_HT_SIZE = (AFS_BSIZE / 4) - 0x38;

	// ----- OFFSETS -----

	// bootblock
	const AFS_BB_fs_type = 0x03;
	const AFS_BB_checksum = 0x04;
	const AFS_BB_rootblock = 0x08;

	// bitmap
	const AFS_BM_checksum = 0x00;
	const AFS_BM_map = 0x04;

	// common
	const AFS_OFF_type = 0x00; // primary type
	const AFS_OFF_header_key = 0x04;
	const AFS_OFF_high_seq = 0x08;
	const AFS_OFF_ht_size = 0x0c;
	const AFS_OFF_first_data = 0x10
	const AFS_OFF_chksum = 0x14;
	const AFS_OFF_sec_type = AFS_BSIZE - 0x04;
	const AFS_OFF_name_len = AFS_BSIZE - 0x50;
	const AFS_OFF_name = AFS_BSIZE - 0x4f;
	const AFS_OFF_hash_chain = AFS_BSIZE - 0x10;

	// root block
	const AFS_ROOT_bm_flag = AFS_BSIZE - 0xc8;
	const AFS_ROOT_bm_pages = AFS_BSIZE - 0xc4;
	const AFS_ROOT_bm_ext = AFS_BSIZE - 0x60;
	const AFS_ROOT_r_days = AFS_BSIZE - 0x5c; // root alteration date
	const AFS_ROOT_r_mins = AFS_BSIZE - 0x58;
	const AFS_ROOT_r_ticks = AFS_BSIZE - 0x54;
	const AFS_ROOT_v_days = AFS_BSIZE - 0x28;
	const AFS_ROOT_v_mins = AFS_BSIZE - 0x24;
	const AFS_ROOT_v_ticks = AFS_BSIZE - 0x20;

	// dir block
	const AFS_DIR_ht = 0x18;
	const AFS_DIR_parent = AFS_BSIZE - 0x0c;

	// file header block
	const AFS_FIL_first_data = 0x10;
	const AFS_FIL_byte_size = AFS_BSIZE - 0xbc;

	// file data block (OFS)
	const AFS_FIL_data_size = 0x0c;
	const AFS_FIL_next_data = 0x10;
	const AFS_FIL_data = 0x18;

	// ----- END OF OFFSETS -----

	const AFS_FsTypes = {
		0: 'OFS',
		1: 'FFS',
		2: 'OFS+INTL',
		3: 'FFS+INTL',
		4: 'OFS+DIRCACHE+INTL',
		5: 'FFS+DIRCACHE+INTL',
	}

	this.sectorCache = new Array();

	/**
	* Error function - override in client code to do something with the errors
	*/
	this.error = function(msg) { }

	/**
	* Callback function to return an arraybuffer containing the specified
	* sector
	*
	* Client code must override this
	*/
	this.getSect = function(sec) {
		throw "readSect() must be overridden";
	}

	/**
	* Helper function to return a DataView of the given sector
	*
	* TODO: caching
	*/
	this.readSect = function(sect) {
		if (this.sectorCache[sect] !== undefined) {
			return this.sectorCache[sect];
		} else {
			ns = new DataView(this.getSect(sect));

			// don't even think about caching the bootblock
			if (sect <= 1) {
				return ns;
			}

			// if it's a header block, cache it. TODO: there will be 'false
			// positives' where the block is something like an FFS data
			// block and where the first long happens to be the value of
			// T_HEADER. For now we just live with that.
			if (ns.getUint32(AFS_OFF_type) == AFS_T_HEADER) {
				this.sectorCache[sect] = ns;
			}

			return ns;
		}
	}

	/**
	* Gets the name (volume label, directory or filename) from the specified
	* sector
	*/
	this.getName = function(sect) {
		blk = this.readSect(sect);
		var nameLen = blk.getUint8(AFS_OFF_name_len);

		if (nameLen > 30) {
			this.error('Name too long');
			return false;
		}

		var name = '';

		for (var i = 0; i < nameLen; i++) {
			name += String.fromCharCode(blk.getUint8(AFS_OFF_name + i));
		}

		return name;
	}

	/**
	* Check standard checksum - this is the normal algoritm used by all
	* blocks except the boot block
	*/
	this.checkStandardChecksum = function(sect, isBitmap) {
		if (typeof isBitmap == 'undefined') {
			isBitmap = false;
		}

		var blk = this.readSect(sect);

		// bitmap checksum is at a different position to other blocks
		var sumPos = isBitmap ? AFS_BM_checksum : AFS_OFF_chksum;
		var sum = 0;
		var oldSum = blk.getUint32(sumPos, false);

		blk.setUint32(sumPos, 0); // clear old checksum

		for (var i = 0; i < AFS_BSIZE; i += 4) {
			sum += blk.getUint32(i);
			if (sum > 0xffffffff) { // 32-bit overflow
				sum -= 0x100000000;
			}
		}

		// negate checksum (invert bits and add 1)
		sum = ~sum + 1;

		// restore old checksum
		blk.setUint32(sumPos, oldSum);

		return (sum == oldSum);
	}

	/**
	* Calculate bootblock checksum (this is a different algorithm to the
	* standard one)
	*/
	this.checkBootBlockChecksum = function(bb) {
		var sum = 0;
		var oldSum = bb[0].getUint32(AFS_BB_checksum);

		bb[0].setUint32(AFS_BB_checksum, 0);

		// loop through the 2 blocks
		for (var idx = 0; idx <= 1; idx++) {
			// and the data in each block
			for (var i = 0; i < AFS_BSIZE; i += 4) {
				sum += bb[idx].getUint32(i);
				if (sum > 0xffffffff) { // 32-bit overflow
					sum -= 0xffffffff;
				}
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
		var bb = new Array();

		// boot 'block' is actually 2 sectors 0 and 1
		bb[0] = this.readSect(0);
		bb[1] = this.readSect(1);

		// is it a DOS disk?
		if (String.fromCharCode(
				bb[0].getUint8(0),
				bb[0].getUint8(1),
				bb[0].getUint8(2))
				!= 'DOS') {
			this.error('Not a DOS disk');
			return false;
		}

		// if valid FS type?
		var fst = bb[0].getUint8(AFS_BB_fs_type);

		if (fst > 5) {
			// unknown AFS type
			this.error('Unrecognised FS type');
			return false;
		}

		this.volumeInfo['fsType'] = fst;
		this.volumeInfo['fsTypeDesc'] = AFS_FsTypes[fst];

		// if checksum is valid disk is bootable
		this.volumeInfo['bootable'] = this.checkBootBlockChecksum(bb);

		// get root block location
		var rb = bb[0].getUint32(AFS_BB_rootblock);

		// default is 880 if not specified
		if (rb == 0) {
			rb = 880;
		}
		this.volumeInfo['rootBlock'] = rb;

		return true;
	}

	/**
	* Process root block - verify checksum, get volume label and other info
	*/
	this.processRootBlock = function() {
		var rbSect = this.volumeInfo['rootBlock'];
		var rb = this.readSect(rbSect);

		if (! this.sanityCheckBlock(rbSect, AFS_T_HEADER, AFS_ST_ROOT)) {
			this.error('Root block failed sanity checking');
			return false;
		}

		// read bitmap block and verify checksum
		var bmSect = rb.getUint32(AFS_ROOT_bm_pages);
		var bm = this.readSect(bmSect);

		if (! this.checkStandardChecksum(bmSect, true)) {
			this.error('Bitmap block checksum invalid');
			return false;
		}

		// all good - now extract volume label and set current dir to here
		this.volumeInfo['label'] = this.getName(rbSect);
		this.currentDir = rbSect;

		// 'valid' means used sector count can be trusted
		this.volumeInfo['valid'] = rb.getUint32(AFS_ROOT_bm_flag)
				== 0xffffffff;

		return true;
	}

	/**
	* Sanity check a block - verify checksum is correct, type is correct and
	* sec_type is correct (if it is provided - file data blocks have no
	* sec_type
	*/
	this.sanityCheckBlock = function(sect, type, secType) {
		var blk = this.readSect(sect);

		if (! this.checkStandardChecksum(sect)) {
			this.error('Checksum invalid for sector ' + sect);
			return false;
		}

		if (blk.getUint32(AFS_OFF_type) != type) {
			this.error('type for sector ' + sect + ' is not ' +
					type.toString(16));
			return false;
		}

		if (typeof secType != 'undefined'
		&& blk.getUint32(AFS_OFF_sec_type) != secType) {
			this.error('sec_type for sector ' + sect + ' is not ' +
					secType.toString(16));
			return false;
		}

		// Block declared sane
		return true;
	}

	/**
	* Read a file using the OFS data block chain (the easy way)
	* TODO: calc data block checksums
	*/
	this.readFileOfs = function(sect) {
		var headerBlock = this.readSect(sect);
		var fileData = '';
		var curSect = headerBlock.getUint32(AFS_FIL_first_data);

		// loop through data blocks and append data
		// TODO: this can be optimised
		while (curSect) {
			var currentBlock = this.readSect(curSect);

			if (! this.sanityCheckBlock(currentBlock, T_DATA)) {
				return false;
			}

			var dataSize = currentBlock.getUint32(AFS_FIL_data_size);

			for (var i = 0; i < dataSize; i++) {
				fileData += String.fromCharCode(currentBlock.getUint8(
						AFS_FIL_data + i));
			}

			curSect = currentBlock.getUint32(AFS_FIL_next_data);
		}

		return fileData;
	}

	/**
	* Read a file using the FFS method (read each block in data_blocks[]
	* then follow file extension block chain)
	*/
	this.readFileFfs = function(sect) {
		var headerBlock = this.readSect(sect);

		var bytesLeft = headerBlock.getUint32(AFS_FILE_byte_size);
		var blocksLeft = headerBlocker.getUint32(AFS_FILE_high_seq);

		var dataBlocks = new Array();
	}


	/************************************************************************
	* Public Methods
	*************************************************************************/

	/**
	* Load a new disk image
	*/
	this.load = function() {
		this.volumeInfo = new Array();

		if (! this.processBootBlock()) {
			return false;
		}

		if (! this.processRootBlock()) {
			return false;
		}

		return true;
	}

	/**
	* Get directory listing
	*/
	this.dir = function() {
		db = this.readSect(this.currentDir);

		var dir = new Array();
		var ent, next, type, secType;

		// Add a parent dir entry if we're not at the root dir
		if (this.currentDir != this.volumeInfo['rootBlock']) {
			dir.push({
				'name': '..',
				'size': 0,
				'type': 'dir',
				'sect': db.getUint32(AFS_DIR_parent),
			});
		}

		for (var i = 0; i < AFS_HT_SIZE * 4; i += 4) {
			ent = db.getUint32(AFS_DIR_ht + i);

			while (ent) {
				cd = this.readSect(ent);

				// set type according to block's sec_type field
				secType = cd.getUint32(AFS_OFF_sec_type);

				switch (secType) {
					case AFS_ST_USERDIR:
						type = 'dir';
						break;
					case AFS_ST_FILE:
						type = 'file';
						break;
					case AFS_ST_SOFTLINK:
					case AFS_ST_LINKFILE:
					case AFS_ST_LINKDIR:
						type = 'link';
						break;
					default:
						this.error('Unknown sec_type "' + secType.toString(16)
							+ '" for block in dir chain');
					return false;
				}

				dir.push({
					'name': this.getName(ent),
					'size': cd.getUint32(AFS_FIL_byte_size),
					'type': type,
					'sect': ent,
				});

				ent = cd.getUint32(AFS_OFF_hash_chain);
			}
		}

		return dir;
	}

	/**
	* Change current directory
	*/
	this.changeDir = function(newDir) {
		this.currentDir = newDir;
	}

	/**
	* Return volume info array
	*/
	this.getVolumeInfo = function() {
		return this.volumeInfo;
	}

	/**
	* Read a file and return its contents. 'sect' is the sector number of
	* the file header block for the file
	*/
	this.readFile = function(sect) {
		// if low bit is set, volume is FFS
		var isFfs = this.volumeInfo['fsType'] & 1;

		var headerBlock = this.readSect(sect);

		// sanity checking
		if (! this.sanityCheckBlock(sect, AFS_T_HEADER, AFS_ST_FILE)) {
			this.error('File header block failed sanity checking');
			return false;
		}

		// call appropriate method to get data
		if (isFfs || this.forceFfs) {
			return this.readFileFfs(sect);
		} else {
			return this.readFileOfs(sect);
		}
	}
}

