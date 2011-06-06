if (!DataView) { alert('no dataview'); }

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

		afs.error = function(msg) {
			alert(msg);
		}

		if (afs.load(buffer)) {
			if (afs.dir()) {
				document.write('OH HAI');
			}
		}
	}
}

go();
