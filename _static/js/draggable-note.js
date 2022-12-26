function initialize_draggable_textarea() {
    for (const note of document.getElementsByClassName("reading-note")) {
        const header = note.getElementsByClassName("reading-note-header")[0];
        var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        header.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }
        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            var style = note.currentStyle || window.getComputedStyle(note);
            note.style.top = (note.offsetTop - pos2 - style.marginTop.replace("px", "")) + "px";
            note.style.left = (note.offsetLeft - pos1) + "px";
        }
        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }
}