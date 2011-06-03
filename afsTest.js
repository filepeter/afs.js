if (!DataView) { alert('no dataview'); }

go();

function go() {
	var xhr = new XMLHttpRequest();
	xhr.open('GET', 'test.adf', false);
	xhr.responseType = 'arraybuffer';
	xhr.send(null);
	buffer = xhr.response;
	if (! buffer) {
		alert('FFFFFUUUUUU');
	} else {
		afs = new Afs();
		if (! afs.load(buffer)) {
			alert('Not a DOS disk');
		} else {
			// Do something cool
			alert('Loaded OK');
		}
	}
}

