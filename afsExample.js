function init() {
	afs = new Afs();

	// set callbacks
	afs.error = function(msg) {
		alert(msg);
	}

	afs.debug = function(msg) {
		console.log(msg);
	};

	afs.dataUrl = 'getSect.php?sect=';

	afs.load(function() {
		refresh();
	});
}

function dirEntryCallback(info) {
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
}

function refresh() {
	var size;

	$('#fileBrowser').empty();
	$('#fileBrowser').append('<ul>');

	afs.dir(function(info) {
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

	init();
});


