function debug(msg) {
	$('#debug pre').append(msg + "\n");
}

function getSect(id) {
	xhr.open('GET', 'getSect.php?sect=' + id, false);

	// gecko and webkit handle this differently and jQuery isn't cool enough
	// to support this yet
	if (xhr.hasOwnProperty('responseType')) {
		xhr.responseType = 'arraybuffer';
	} else {
		xhr.overrideMimeType('text/plain; charset=x-user-defined');
	}

	xhr.send(null);

	if (xhr.mozResponseArrayBuffer != null) {
		sector = xhr.mozResponseArrayBuffer;
	} else {
		sector = xhr.response;
	}

	if (! sector) {
		alert("Couldn't read file");
		return false;
	}

	return sector;
}

function init() {
	xhr = new XMLHttpRequest();

	afs = new Afs();

	// set callbacks
	afs.error = function(msg) {
		alert(msg);
	}

	afs.getSect = getSect;

	if (! afs.load()) {
		alert("Couldn't read disk image");
		return false;
	}

	return true;
}

function refresh() {
	var size;

	$('#fileBrowser').empty();
	$('#fileBrowser').append('<ul>');

	afs.dir(function(info) {
		if (info) {

		switch (info.type) {
			case 'file':
				size = info.size; // TODO: format size
				break;
			case 'dir':
				size = '[DIR]';
				break;
			case 'link':
				size = '[LINK]';
		}

		prefix = info.type.charAt(0);

		$('#fileBrowser ul').append('<li class="' + info.type + '" ' +
				'id="' + prefix + info.sect +'">' +
				'<span class="entName">' + info.name + '</span>' +
				'<span class="size">' + size + '</span>');
		} else {
			debug("end of list");
		}
	});
}

$(document).ready(function() {
	$('#fileBrowser li').live('click', function() {
		var id = $(this).attr('id');
		if (id.charAt(0) == 'd') {
			afs.changeDir(id.substring(1));
			refresh();
		} else if (id.charAt(0) == 'f') {
			var file = afs.readFile(id.substring(1));
			if (file !== false) {
				alert(file);
			}
		}
	});

	if (init()) {
		refresh();
	}
});


