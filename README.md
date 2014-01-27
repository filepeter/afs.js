afsjs - Amiga Filesystem in javascript

Copyright 2011-2014 by Dan Sutherland

afsjs implements the Amiga filesystem in your browser. You can use it to
browse Amiga disk images on a server and read files from it.

(OK, this is a lie - since *evil browser makers* deprecated synchronous XHR I've had to
refactor it to be event-driven. You can browse volumes but can't read files yet)

The file afs.js is the actual class the implements AFS. The remaining files in
this archive are for a demo of its use. The demo lets you browse the Assasins
games disk 1.

INSTRUCTIONS
============

Probably the best way to see how to use the class is by looking at the demo
files - index.html, afsTest.js and getSect.php. However here is a quick
overview:

1. Include the AFS class in your page:

<script type="text/javascript" src="afs.js"></script>

2. Create a function that will return an ArrayBuffer containing the specified
512-bytes sector from the disk image you want to access.

3. Instantiate the Afs class:

var afs = new Afs();

4. (Optional) override the error function to notify the user of any errors:

afs.error = function(msg) { alert(msg); }

5. Override the getSect function with your function created earlier:

afs.getSect = myGetSect;

TODO:

- Support for international mode
- Use directory cache blocks
- Support for hardfiles
- Write support

