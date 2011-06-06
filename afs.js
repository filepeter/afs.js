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

	// secondary types
	const AFS_ST_ROOT = 0x01;
	const AFS_ST_USERDIR = 0x02;
	const AFS_ST_FILE = 0xfffffffd; // -3, but we're using usigned ints

	const AFS_BSIZE = 0x200;
	const AFS_HT_SIZE = (AFS_BSIZE / 4) - 0x38;

	// ----- OFFSETS -----

	// bootblock
	const AFS_BB_checksum = 0x04;
	const AFS_BB_rootblock = 0x08;

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

	// ----- END OF OFFSETS -----

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

		if (! this.processRootBlock()) {
			return false;
		}

		return true;
	}

	/**
	* Error function - just saves the error message but can be overridden to
	* pop up a dialogue or whatever
	*/
	this.error = function(msg) {
		this.errorMessage = msg;
	}

	/**
	* Helper function to return a DataView of the given sector
	*/
	this.getBlock = function(sect) {
		return new DataView(this.image, sect * AFS_BSIZE, AFS_BSIZE);
	}

	this.getName = function(sect) {
		blk = this.getBlock(sect);
		var nameLen = blk.getUint8(AFS_OFF_name_len);

		if (nameLen > 30) {
			this.error('Disk name too long');
			return false;
		}

		var name = '';

		for (var i = 0; i < nameLen; i++) {
			name += String.fromCharCode(blk.getUint8(AFS_OFF_name + i));
		}

		return name;
	}


	// checksums

	/**
	* Check standard checksum - this is the normal algoritm used by all
	* blocks except the boot block
	*/
	this.checkStandardChecksum = function(sect) {
		blk = this.getBlock(sect);

		var sum = 0;
		var oldSum = blk.getUint32(AFS_OFF_chksum);
		blk.setUint32(AFS_OFF_chksum, 0); // clear old checksum

		for (var i = 0; i < AFS_BSIZE; i += 4) {
			sum += blk.getUint32(i);
			if (sum > 0xffffffff) { // 32-bit overflow
				sum -= 0x100000000;
			}
		}

		// negate checksum (invert bits and add 1)
		sum = ~sum + 1;

		return (sum == oldSum);
	}

	/**
	* Calculate bootblock checksum (this is a different algorithm to the
	* standard one)
	*/
	this.checkBootBlockChecksum = function() {
		var sum = 0;
		var bb = this.bootBlock;
		var oldSum = bb.getUint32(AFS_BB_checksum);

		bb.setUint32(AFS_BB_checksum, 0);
		for (var i = 0; i < this.bootBSize; i += 4) {
			sum += bb.getUint32(i);
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
		this.bootBlockSize = AFS_BSIZE * 2; // TODO: hardfile support
		this.bootBlock = new DataView(this.image, 0, this.bootBlockSize);

		// is it a DOS disk?
		if (String.fromCharCode(
				this.bootBlock.getUint8(0),
				this.bootBlock.getUint8(1),
				this.bootBlock.getUint8(2))
				!= 'DOS') {
			this.error('Not a DOS disk');
			return false;
		}

		// if valid FS type?
		this.fsType = this.bootBlock.getUint8(3);

		if (this.fsType > 5) {
			// unknown AFS type
			this.error('Unknown FS type');
			return false;
		}

		// if checksum is valid disk is bootable
		this.bootable = this.checkBootBlockChecksum();

		// get root block location
		this.rootBlock = this.bootBlock.getUint32(AFS_BB_rootblock, false);

		return true;
	}

	/**
	* Process root block - verify checksum, get volume label and other info
	*/
	this.processRootBlock = function() {
		rb = this.getBlock(this.rootBlock);

		// check type is correct first
		if (rb.getUint32(AFS_OFF_type) != AFS_T_HEADER) {
			this.error('Root block type is not T_HEADER');
			return false;
		}

		// and sec_type
		if (rb.getUint32(AFS_OFF_sec_type) != AFS_ST_ROOT) {
			this.error('Root block sec_type is not ST_ROOT');
			return false;
		}

		// then check checksum
		if (! this.checkStandardChecksum(this.rootBlock)) {
			this.error('Root block checksum invalid');
			return false;
		}

		// all good - now extract volume label and set current dir to here
		this.diskName = this.getName(this.rootBlock);
		this.currentDir = this.rootBlock;

		return true;
	}

	/**
	* Get directory listing
	*/
	this.dir = function() {
		db = this.getBlock(this.currentDir);

		var table = new Array();
		var ent;
		var next;

		for (var i = 0; i < AFS_HT_SIZE; i += 4) {
			ent = db.getUint32(AFS_DIR_ht + i);

			while (ent) {
				cd = this.getBlock(ent);

				if (cd.getUint32(AFS_OFF_sec_type) != AFS_ST_USERDIR &&
						cd.getUint32(AFS_OFF_sec_type) != AFS_ST_FILE) {
					this.error('Unknown sec_type for block in dir chain');
					return false;
				}

console.log(this.getName(ent));

				ent = cd.getUint32(AFS_OFF_hash_chain);
			}
		}

		return true;
	}

}

