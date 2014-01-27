/**
* afsjs - Amiga Filesystem implementation in javascript
*
* Copyright 2011-2012 by Dan Sutherland <djs@djs.org.uk>
*
* This code may be distributed, modified and used for any purpose provided
* this copyright notice is left intact and/or the author is credited in the
* documentation of any software or service using this code.
*
* About variable naming: generally the terms 'block' and 'sector' are
* interchangeable, however in this code they have explicit meanings - 'block'
* refers to the address of a sector on disk (an integer between 0 and 1759 for
* a standard DD disk). 'sector' refers to the actual data within the sector -
* here, an ArrayBuffer 512 bytes in size.
*
* TODO:
* - verify checksums for OFS data blocks
* - international mode
*/

function Afs() {
	// primary types
	const AFS_T_HEADER = 0x02;
	const AFS_T_DATA = 0x08;
	const AFS_T_LIST = 0x10;

	// secondary types
	const AFS_ST_ROOT = 0x01;
	const AFS_ST_USERDIR = 0x02;
	const AFS_ST_SOFTLINK = 0x03;
	const AFS_ST_LINKDIR = 0x04;
	const AFS_ST_FILE = 0xfffffffd; // -3, but we're using usigned ints
	const AFS_ST_LINKFILE = 0xfffffffc; // -4

	const AFS_SECTSIZE = 0x200;
	const AFS_HT_SIZE = (AFS_SECTSIZE / 4) - 0x38;

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
	const AFS_OFF_sec_type = AFS_SECTSIZE - 0x04;
	const AFS_OFF_name_len = AFS_SECTSIZE - 0x50;
	const AFS_OFF_name = AFS_SECTSIZE - 0x4f;
	const AFS_OFF_hash_chain = AFS_SECTSIZE - 0x10;

	// root block
	const AFS_ROOT_bm_flag = AFS_SECTSIZE - 0xc8;
	const AFS_ROOT_bm_pages = AFS_SECTSIZE - 0xc4;
	const AFS_ROOT_bm_ext = AFS_SECTSIZE - 0x60;
	const AFS_ROOT_r_days = AFS_SECTSIZE - 0x5c; // root alteration date
	const AFS_ROOT_r_mins = AFS_SECTSIZE - 0x58;
	const AFS_ROOT_r_ticks = AFS_SECTSIZE - 0x54;
	const AFS_ROOT_v_days = AFS_SECTSIZE - 0x28;
	const AFS_ROOT_v_mins = AFS_SECTSIZE - 0x24;
	const AFS_ROOT_v_ticks = AFS_SECTSIZE - 0x20;

	// dir block
	const AFS_DIR_ht = 0x18;
	const AFS_DIR_parent = AFS_SECTSIZE - 0x0c;

	// file header block
	const AFS_FIL_high_seq = 0x08;
	const AFS_FIL_first_data = 0x10;
	const AFS_FIL_data_blocks = 0x18;
	const AFS_FIL_data_blocks_last = AFS_SECTSIZE - 0xcc;
	const AFS_FIL_byte_size = AFS_SECTSIZE - 0xbc;
	const AFS_FIL_extension = AFS_SECTSIZE - 0x08;

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
	* Debug function - override in client code to do something with the debug messages
	*/
	this.debug = function(msg) { }

	/**
	* Helper function to return a DataView of the given sector
	*/
	this.readSect = function(block, callback) {
		this.debug('readSect: ' + block);

		if (!(this instanceof Afs)) {
			alert('oh fuck we are not Afs');
		}

		// In the case of a cache hit just return cached sector
		if (this.sectorCache[block] !== undefined) {
			this.debug('Cache hit for block ' + block);
			callback.call(this, this.sectorCache[block]);
			return true;
		}

		var xhr = new XMLHttpRequest();
		xhr.open('GET', 'getSect.php?sect=' + block, true);
		xhr.responseType = 'arraybuffer';

		var self = this;

		xhr.onreadystatechange = function() {
			if (xhr.readyState == 4) {
				if (xhr.status == 200) {
					var data = xhr.response;

					if (data) {
						newSect = new DataView(data);

						// Don't cache the bootblock since there should be no reason to
						// read it more than once
						if (block <= 1) {
							self.debug('Not caching sector ' + block + ' because it is a bootsector');
							callback.call(self, newSect);
							return true;
						}

						// if it's a header block, cache it. TODO: there will be 'false
						// positives' where the block is something like an FFS data
						// block and where the first long happens to be the value of
						// T_HEADER. For now we just live with that.
						if (newSect.getUint32(AFS_OFF_type) == AFS_T_HEADER) {
							self.debug('caching sector ');
							self.sectorCache[block] = newSect;
						}

						callback.call(self, newSect);
					} else {
						self.error('Fucked up: ' + xhr.statusText);
					}
				}
			}
		};

		xhr.send(null);
	}

	/**
	* Gets the name (volume label, directory or filename) from the specified
	* sector
	*/
	this.getName = function(sect) {
		var nameLen = sect.getUint8(AFS_OFF_name_len);

		if (nameLen > 30) {
			this.error('Name too long');
			return false;
		}

		var name = '';

		for (var i = 0; i < nameLen; i++) {
			name += String.fromCharCode(sect.getUint8(AFS_OFF_name + i));
		}

		return name;
	}

	/**
	* Check standard checksum - this is the normal algoritm used by all
	* blocks except the boot block
	*/
	this.checkStandardChecksum = function(sect, isBitmap) {
		this.debug('Validating checksum');

		if (typeof isBitmap == 'undefined') {
			isBitmap = false;
		}

		this.debug('Is it a bitmap? ' + isBitmap);

		// bitmap checksum is at a different position to other blocks
		var sumPos = isBitmap ? AFS_BM_checksum : AFS_OFF_chksum;
		var sum = 0;
		var oldSum = sect.getUint32(sumPos, false);

		sect.setUint32(sumPos, 0); // clear old checksum

		for (var i = 0; i < AFS_SECTSIZE; i += 4) {
			sum += sect.getUint32(i);
			var j = i / 4;
			if (sum > 0xffffffff) { // 32-bit overflow
				sum -= 0x100000000;
			}
		}

		// negate checksum
		sum = -sum;

		// if the checksum is negative javascript won't give us the result we
		// expect since it stores numbers as double precision floats. Fix by
		// doing the twos complement ourselves
		if (sum < 0) {
			sum = 0xffffffff + sum + 1;
		}

		// restore old checksum
		sect.setUint32(sumPos, oldSum);

		isValid = (sum == oldSum);

		this.debug('Is it valid? ' + isValid);

		return isValid;
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
			for (var i = 0; i < AFS_SECTSIZE; i += 4) {
				sum += bb[idx].getUint32(i);
				if (sum > 0xffffffff) { // 32-bit overflow
					sum -= 0xffffffff;
				}
			}
		}

		sum = ~sum;

		return (sum == oldSum);
	}

	this.processFirstBootBlock = function(sect) {
		this.bb[0] = sect;
		this.readSect(1, this.processSecondBootBlock);
	};

	this.processSecondBootBlock = function(sect) {
		this.bb[1] = sect;

		// is it a DOS disk?
		if (String.fromCharCode(
				this.bb[0].getUint8(0),
				this.bb[0].getUint8(1),
				this.bb[0].getUint8(2))
				!= 'DOS') {
			this.error('Not a DOS disk');
		}

		// is valid FS type?
		var fst = this.bb[0].getUint8(AFS_BB_fs_type);

		if (fst > 5) {
			// unknown AFS type
			this.error('Unrecognised FS type');
			return false;
		}

		this.volumeInfo['fsType'] = fst;
		this.volumeInfo['fsTypeDesc'] = AFS_FsTypes[fst];

		// if checksum is valid disk is bootable
		this.volumeInfo['bootable'] = this.checkBootBlockChecksum(this.bb);

		// get root block location
		var rb = this.bb[0].getUint32(AFS_BB_rootblock);

		// default is 880 if not specified
		if (rb == 0) {
			rb = 880;
		}

		this.volumeInfo['rootBlock'] = rb;
		this.debug('rootblock location is: ' + rb);

		this.readSect(rb, this.processRootBlock);
	};

	/**
	* Check bootblock - make sure we have a valid DOS disk, check if bootable,
	* determine location of root block
	*/
	this.processBootBlock = function() {
		this.bb = new Array();
		this.readSect(0, this.processFirstBootBlock);
	}

	/**
	* Process root block - verify checksum, get volume label and other info
	*/
	this.processRootBlock = function(sect) {
		this.debug('Processing rootblock');
	
		if (!this.sanityCheckBlock(sect, AFS_T_HEADER, AFS_ST_ROOT)) {
			this.error('Root block failed sanity checking');
			return false;
		}

		this.debug('Rootblock declared sane');

		// all good - now extract volume label and set current dir to here
		this.volumeInfo['label'] = this.getName(sect);
		this.currentDir = this.volumeInfo['rootBlock'];

		this.debug('Volume label is: ' + this.volumeInfo['label']);

		// get location of bitmap block
		var bmBlock = sect.getUint32(AFS_ROOT_bm_pages);

		this.readSect(bmBlock, this.processBitmapBlock);
	}

	/**
	* Process bitmap block - verify checksum
	*/
	this.processBitmapBlock = function(sect) {
		this.debug('Processing bitmap block');

		if (!this.checkStandardChecksum(sect, true)) {
			this.error('Bitmap block checksum invalid');
			return false;
		}

		// 'valid' means used sector count can be trusted
		this.volumeInfo['valid'] = sect.getUint32(AFS_ROOT_bm_flag)
				== 0xffffffff;

		this.refreshFunction();
	};

	/**
	* Sanity check a block - verify checksum is correct, type is correct and
	* sec_type is correct (if it is provided - file data blocks have no
	* sec_type)
	*/
	this.sanityCheckBlock = function(sect, type, secType) {
		if (!this.checkStandardChecksum(sect)) {
			this.error('Checksum invalid for sector ' + sect);
			return false;
		}

		if (sect.getUint32(AFS_OFF_type) != type) {
			this.error('type for sector ' + sect + ' is not ' +
					type.toString(16));
			return false;
		}

		if (typeof secType != 'undefined'
		&& sect.getUint32(AFS_OFF_sec_type) != secType) {
			this.error('sec_type for sector is not ' +
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
			if (!this.sanityCheckBlock(curSect, AFS_T_DATA)) {
				return false;
			}

			var currentBlock = this.readSect(curSect);

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
		var headerSect = this.readSect(sect);

		var bytesLeft = headerSect.getUint32(AFS_FIL_byte_size);

		if (bytesLeft == 0) {
			return '';
		}

		var highSeq = headerSect.getUint32(AFS_FIL_high_seq);
		var headerOffset = 0; // offset into data_blocks[]
		var bytesInBlock;

		var fileData = '';

		while (bytesLeft) {
			// first data block is the *last* entry in data_blocks[]
			var currentData = headerSect.getUint32(AFS_FIL_data_blocks_last -
					(headerOffset * 4));
			headerOffset++;

			bytesInBlock = bytesLeft > AFS_SECTSIZE ? AFS_SECTSIZE : bytesLeft;

			var dataSect = this.readSect(currentData);

			for (var i = 0; i < bytesInBlock; i++) {
				fileData += String.fromCharCode(dataSect.getUint8(i));
			}

			bytesLeft -= bytesInBlock;

			// if we haven't read all the file and we are at the last data
			// block we need to fetch the next file extension block
			if (bytesLeft && headerOffset == highSeq) {
				headerSect = this.readSect(headerSect.getUint32(
					AFS_FIL_extension));
				headerOffset = 0;
				highSeq = headerSect.getUint32(AFS_FIL_high_seq);
			}
		}

		return fileData;
	}

	/************************************************************************
	* Public Methods
	*************************************************************************/

	/**
	* Load a new disk image
	*/
	this.load = function(callback) {
		this.volumeInfo = new Array();
		this.refreshFunction = callback;
		this.processBootBlock();
	}

	/**
	* Eject disk and free up memory
	*/
	this.eject = function() {
		this.volumeInfo = new Array();
		this.sectorCache = new Array();
	}

	/**
	* Get directory listing
	*/
	this.dir = function() {
		this.readSect.call(this, this.currentDir, this.processDirectory);
	}

	this.processDirEntry = function(sect) {
		this.debug('processDirEntry');

		// We're done if we're at the end of the hash table
		if (this.currentHashtableEntry == (AFS_HT_SIZE * 4)) {
			return;
		}

		// set type according to block's sec_type field
		secType = sect.getUint32(AFS_OFF_sec_type);
		this.debug('Sec type: ' + secType.toString(16));

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

		info = {
			'name': this.getName(sect),
			'size': sect.getUint32(AFS_FIL_byte_size),
			'type': type,
			'sect': this.currentDirEntry,
		};
		this.dirEntry(info);

		var nextBlock = sect.getUint32(AFS_OFF_hash_chain);

		if (0 != nextBlock) {
			this.debug('Following hash chain');
			this.currentDirEntry = nextBlock;
			this.readSect(nextBlock, this.processDirEntry);
			return;
		}

		this.debug('End of hash chain');

		this.currentHashtableEntry += 4;
		this.debug('hash table entry: ' + this.currentHashtableEntry.toString(10));

		while (0 == nextBlock && this.currentHashtableEntry < AFS_HT_SIZE * 4) {
			nextBlock = this.currentDirBlock.getUint32(AFS_DIR_ht + this.currentHashtableEntry);
			this.debug('Trying block ' + nextBlock.toString(10));
			this.currentHashtableEntry += 4;
		}

		if (0 != nextBlock) {
			this.currentDirEntry = nextBlock;
			this.readSect(nextBlock, this.processDirEntry);
		}		
	}

	this.processDirectory = function(sect) {
		this.debug('processDirectory()');

		if (!this.sanityCheckBlock(sect, AFS_T_HEADER)) {
			return false; // TODO: exception?
		}

		// Add a parent dir entry if we're not at the root dir
		if (this.currentDir != this.volumeInfo['rootBlock']) {
			info = {
				'name': '..',
				'size': 0,
				'type': 'dir',
				'sect': sect.getUint32(AFS_DIR_parent),
			};
			this.dirEntry(info);
		}

		this.currentDirBlock = sect;
		this.currentHashtableEntry = 0;

		var startingBlock = 0;

		while (0 == startingBlock && this.currentHashtableEntry < AFS_HT_SIZE * 4) {
			startingBlock = sect.getUint32(AFS_DIR_ht + this.currentHashtableEntry);
			this.debug('Trying block ' + startingBlock.toString(10));
			this.currentHashtableEntry += 4;
		}

		// Directory was empty
		if (0 == this.currentHashtableEntry) {
			this.debug('Empty directory');
			return;
		}

		this.debug('First non null hashtable entry is ' + startingBlock.toString(10) + 
			' at offset ' + this.currentHashtableEntry.toString(10) + ' (index ' + 
			(this.currentHashtableEntry / 4).toString(10) + ')');
		this.readSect(startingBlock, this.processDirEntry);
	}

	/**
	* Change current directory
	*/
	this.changeDir = function(newDir) {
		this.debug('Changing current dir to block ' + newDir);
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

