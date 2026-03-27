/**
 * LVGL Visual Designer
 * Handles the visual canvas, drag-and-drop, widget selection, property editing,
 * widget tree, undo/redo, and all interactive design operations.
 */

const Designer = (() => {
    // ---- State ----
    let state = {
        pages: [{ id: 'main_page', name: 'Main', widgets: [] }],
        currentPageIndex: 0,
        selectedWidgetId: null,
        displayWidth: 170,
        displayHeight: 320,
        nextId: 1,
        undoStack: [],
        redoStack: [],
        clipboard: null,
    };

    let canvasEl = null;
    let canvasScaleWrapper = null;
    let propertiesPanel = null;
    let widgetTreeEl = null;
    let onStateChange = null; // callback for YAML sync

    // Zoom state
    let zoomLevel = 1;
    const ZOOM_MIN = 0.25;
    const ZOOM_MAX = 4;
    const ZOOM_STEP = 0.25;

    // Multi-select state
    let multiSelectedIds = [];
    let marqueeState = null;

    // ---- Initialization ----
    function init(options = {}) {
        canvasEl = document.getElementById('canvas');
        canvasScaleWrapper = document.getElementById('canvas-scale-wrapper');
        propertiesPanel = document.getElementById('properties-panel');
        widgetTreeEl = document.getElementById('widget-tree');
        onStateChange = options.onStateChange || null;

        setDisplaySize(state.displayWidth, state.displayHeight);
        setupCanvasEvents();
        setupKeyboardShortcuts();
        setupZoomControls();
        setupAlignToolbar();
        setupRightPanelResize();
        renderAll();
    }

    // ---- Display Size ----
    function setDisplaySize(w, h) {
        state.displayWidth = w;
        state.displayHeight = h;
        if (canvasEl) {
            canvasEl.style.width = w + 'px';
            canvasEl.style.height = h + 'px';
        }
    }

    // ---- Page Management ----
    function getCurrentPage() {
        return state.pages[state.currentPageIndex];
    }

    function addPage(name) {
        pushUndo();
        const id = 'page_' + state.nextId++;
        state.pages.push({ id, name: name || `Page ${state.pages.length + 1}`, widgets: [] });
        state.currentPageIndex = state.pages.length - 1;
        state.selectedWidgetId = null;
        renderAll();
        notifyChange();
    }

    function removePage(index) {
        if (state.pages.length <= 1) return;
        pushUndo();
        state.pages.splice(index, 1);
        if (state.currentPageIndex >= state.pages.length) {
            state.currentPageIndex = state.pages.length - 1;
        }
        state.selectedWidgetId = null;
        renderAll();
        notifyChange();
    }

    function switchPage(index) {
        if (index < 0 || index >= state.pages.length) return;
        state.currentPageIndex = index;
        state.selectedWidgetId = null;
        renderAll();
    }

    // ---- Widget CRUD ----
    function generateId(type) {
        return type + '_' + state.nextId++;
    }

    function createWidget(type, x, y, parentId) {
        const def = LVGLWidgets.getWidgetDef(type);
        if (!def) return null;

        pushUndo();
        const widget = {
            id: generateId(type),
            type,
            x: x || 0,
            y: y || 0,
            width: def.defaultSize.width,
            height: def.defaultSize.height,
            properties: { ...LVGLWidgets.getDefaultProperties(type) },
            styles: LVGLWidgets.getDefaultStyles(type),
            events: {},
            children: [],
        };

        // Auto-create child label for buttons
        if (type === 'button') {
            widget.children.push({
                id: generateId('label'),
                type: 'label',
                x: 0, y: 0,
                width: def.defaultSize.width,
                height: def.defaultSize.height,
                properties: { text: 'Button' },
                styles: {},
                events: {},
                children: [],
            });
        }

        const page = getCurrentPage();
        if (parentId) {
            const parent = findWidgetById(parentId, page.widgets);
            if (parent && LVGLWidgets.canContainChildren(parent.type)) {
                parent.children.push(widget);
            } else {
                page.widgets.push(widget);
            }
        } else {
            page.widgets.push(widget);
        }

        state.selectedWidgetId = widget.id;
        renderAll();
        notifyChange();
        return widget;
    }

    function deleteWidget(widgetId) {
        if (!widgetId) return;
        pushUndo();
        const page = getCurrentPage();
        removeWidgetFromTree(widgetId, page.widgets);
        if (state.selectedWidgetId === widgetId) {
            state.selectedWidgetId = null;
        }
        renderAll();
        notifyChange();
    }

    function duplicateWidget(widgetId) {
        if (!widgetId) return;
        const page = getCurrentPage();
        const widget = findWidgetById(widgetId, page.widgets);
        if (!widget) return;

        pushUndo();
        const clone = deepCloneWidget(widget);
        clone.x += 20;
        clone.y += 20;
        page.widgets.push(clone);
        state.selectedWidgetId = clone.id;
        renderAll();
        notifyChange();
    }

    function deepCloneWidget(widget) {
        const clone = JSON.parse(JSON.stringify(widget));
        clone.id = generateId(clone.type);
        if (clone.children) {
            clone.children = clone.children.map(c => deepCloneWidget(c));
        }
        return clone;
    }

    function findWidgetById(id, widgets) {
        for (const w of widgets) {
            if (w.id === id) return w;
            if (w.children) {
                const found = findWidgetById(id, w.children);
                if (found) return found;
            }
        }
        return null;
    }

    function removeWidgetFromTree(id, widgets) {
        for (let i = widgets.length - 1; i >= 0; i--) {
            if (widgets[i].id === id) {
                widgets.splice(i, 1);
                return true;
            }
            if (widgets[i].children && removeWidgetFromTree(id, widgets[i].children)) {
                return true;
            }
        }
        return false;
    }

    function updateWidgetProperty(widgetId, key, value) {
        const page = getCurrentPage();
        const widget = findWidgetById(widgetId, page.widgets);
        if (!widget) return;

        pushUndo();
        // Handle top-level position/size props
        if (['x', 'y', 'width', 'height'].includes(key)) {
            widget[key] = value;
        } else if (key === 'text' && widget.type === 'button') {
            // Sync button text to child label (create one if missing)
            let childLabel = widget.children?.find(c => c.type === 'label');
            if (!childLabel) {
                childLabel = {
                    id: generateId('label'),
                    type: 'label',
                    x: 0, y: 0,
                    width: widget.width,
                    height: widget.height,
                    properties: { text: '' },
                    styles: {},
                    events: {},
                    children: [],
                };
                if (!widget.children) widget.children = [];
                widget.children.push(childLabel);
            }
            childLabel.properties.text = value;
        } else {
            widget.properties[key] = value;
        }
        renderAll();
        notifyChange();
    }

    function updateWidgetStyle(widgetId, part, prop, value, lvglState) {
        const page = getCurrentPage();
        const widget = findWidgetById(widgetId, page.widgets);
        if (!widget) return;

        pushUndo();
        if (!widget.styles) widget.styles = {};
        if (!widget.styles[part]) widget.styles[part] = {};

        if (lvglState && lvglState !== 'DEFAULT') {
            // State-specific style: stored under _states.<state>.<prop>
            const stateKey = lvglState.toLowerCase();
            if (!widget.styles[part]._states) widget.styles[part]._states = {};
            if (!widget.styles[part]._states[stateKey]) widget.styles[part]._states[stateKey] = {};
            if (value === null || value === '' || value === undefined) {
                delete widget.styles[part]._states[stateKey][prop];
                // Clean up empty state objects
                if (Object.keys(widget.styles[part]._states[stateKey]).length === 0) {
                    delete widget.styles[part]._states[stateKey];
                }
                if (Object.keys(widget.styles[part]._states).length === 0) {
                    delete widget.styles[part]._states;
                }
            } else {
                widget.styles[part]._states[stateKey][prop] = value;
            }
        } else {
            // Default state: stored directly on the part
            if (value === null || value === '' || value === undefined) {
                delete widget.styles[part][prop];
            } else {
                widget.styles[part][prop] = value;
            }
        }
        renderAll();
        notifyChange();
    }

    // ---- Event/Action Management ----
    function addEventAction(widgetId, eventName, actionType) {
        const page = getCurrentPage();
        const widget = findWidgetById(widgetId, page.widgets);
        if (!widget) return;
        pushUndo();
        if (!widget.events) widget.events = {};
        if (!widget.events[eventName]) widget.events[eventName] = [];
        const actionDef = LVGLWidgets.ACTION_TYPES[actionType];
        const fields = {};
        if (actionDef) {
            for (const [key, fDef] of Object.entries(actionDef.fields)) {
                fields[key] = '';
            }
        }
        widget.events[eventName].push({ type: actionType, fields });
        renderAll();
        notifyChange();
    }

    function updateEventAction(widgetId, eventName, actionIndex, fieldName, value) {
        const page = getCurrentPage();
        const widget = findWidgetById(widgetId, page.widgets);
        if (!widget?.events?.[eventName]?.[actionIndex]) return;
        pushUndo();
        widget.events[eventName][actionIndex].fields[fieldName] = value;
        renderAll();
        notifyChange();
    }

    function removeEventAction(widgetId, eventName, actionIndex) {
        const page = getCurrentPage();
        const widget = findWidgetById(widgetId, page.widgets);
        if (!widget?.events?.[eventName]) return;
        pushUndo();
        widget.events[eventName].splice(actionIndex, 1);
        if (widget.events[eventName].length === 0) {
            delete widget.events[eventName];
        }
        renderAll();
        notifyChange();
    }

    // ---- Undo/Redo ----
    function pushUndo() {
        state.undoStack.push(JSON.stringify({
            pages: state.pages,
            currentPageIndex: state.currentPageIndex,
            selectedWidgetId: state.selectedWidgetId,
        }));
        if (state.undoStack.length > 50) state.undoStack.shift();
        state.redoStack = [];
    }

    function undo() {
        if (state.undoStack.length === 0) return;
        state.redoStack.push(JSON.stringify({
            pages: state.pages,
            currentPageIndex: state.currentPageIndex,
            selectedWidgetId: state.selectedWidgetId,
        }));
        const prev = JSON.parse(state.undoStack.pop());
        state.pages = prev.pages;
        state.currentPageIndex = prev.currentPageIndex;
        state.selectedWidgetId = prev.selectedWidgetId;
        renderAll();
        notifyChange();
    }

    function redo() {
        if (state.redoStack.length === 0) return;
        state.undoStack.push(JSON.stringify({
            pages: state.pages,
            currentPageIndex: state.currentPageIndex,
            selectedWidgetId: state.selectedWidgetId,
        }));
        const next = JSON.parse(state.redoStack.pop());
        state.pages = next.pages;
        state.currentPageIndex = next.currentPageIndex;
        state.selectedWidgetId = next.selectedWidgetId;
        renderAll();
        notifyChange();
    }

    // ---- Canvas Events ----
    let dragState = null;

    function setupCanvasEvents() {
        canvasEl.addEventListener('mousedown', onCanvasMouseDown);
        document.addEventListener('mousemove', onCanvasMouseMove);
        document.addEventListener('mouseup', onCanvasMouseUp);
        canvasEl.addEventListener('click', onCanvasClick);

        // Drag from palette
        canvasEl.addEventListener('dragover', onCanvasDragOver);
        canvasEl.addEventListener('drop', onCanvasDrop);
    }

    function onCanvasClick(e) {
        if (PreviewMode.isActive()) return;
        if (e.target === canvasEl || e.target === canvasScaleWrapper) {
            state.selectedWidgetId = null;
            multiSelectedIds = [];
            renderAll();
        }
    }

    function onCanvasMouseDown(e) {
        if (PreviewMode.isActive()) return;
        const widgetEl = e.target.closest('.canvas-widget');

        // Start marquee selection if clicking on empty canvas
        if (!widgetEl && (e.target === canvasEl || e.target === canvasScaleWrapper)) {
            const rect = canvasEl.getBoundingClientRect();
            marqueeState = {
                startX: (e.clientX - rect.left) / zoomLevel,
                startY: (e.clientY - rect.top) / zoomLevel,
            };
            return;
        }

        if (!widgetEl) return;

        const widgetId = widgetEl.dataset.widgetId;

        // Ctrl/Cmd+click for multi-select
        if (e.ctrlKey || e.metaKey) {
            if (multiSelectedIds.includes(widgetId)) {
                multiSelectedIds = multiSelectedIds.filter(id => id !== widgetId);
            } else {
                if (state.selectedWidgetId && !multiSelectedIds.includes(state.selectedWidgetId)) {
                    multiSelectedIds.push(state.selectedWidgetId);
                }
                multiSelectedIds.push(widgetId);
            }
            state.selectedWidgetId = widgetId;
            renderAll();
            return;
        }

        // Normal click - clear multi-select
        multiSelectedIds = [];
        state.selectedWidgetId = widgetId;
        renderAll();

        // Check for resize handles
        const handle = e.target.closest('.resize-handle');
        if (handle) {
            e.preventDefault();
            const dir = handle.className.split(' ').find(c => !c.includes('resize'));
            const page = getCurrentPage();
            const widget = findWidgetById(widgetId, page.widgets);
            if (widget) {
                dragState = {
                    type: 'resize',
                    widgetId,
                    dir: handle.dataset.dir,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: widget.x,
                    origY: widget.y,
                    origW: widget.width,
                    origH: widget.height,
                    pushed: false,
                };
            }
            return;
        }

        // Start move
        e.preventDefault();
        const page = getCurrentPage();
        const widget = findWidgetById(widgetId, page.widgets);
        if (widget) {
            dragState = {
                type: 'move',
                widgetId,
                startX: e.clientX,
                startY: e.clientY,
                origX: widget.x,
                origY: widget.y,
                pushed: false,
            };
        }
    }

    function onCanvasMouseMove(e) {
        // Handle marquee selection
        if (marqueeState) {
            const wrapper = document.getElementById('canvas-wrapper');
            const rect = canvasEl.getBoundingClientRect();
            const curX = (e.clientX - rect.left) / zoomLevel;
            const curY = (e.clientY - rect.top) / zoomLevel;

            let marqueeEl = document.getElementById('selection-marquee');
            if (!marqueeEl) {
                marqueeEl = document.createElement('div');
                marqueeEl.id = 'selection-marquee';
                marqueeEl.className = 'selection-marquee';
                canvasEl.appendChild(marqueeEl);
            }

            const mx = Math.min(marqueeState.startX, curX);
            const my = Math.min(marqueeState.startY, curY);
            const mw = Math.abs(curX - marqueeState.startX);
            const mh = Math.abs(curY - marqueeState.startY);

            marqueeEl.style.left = mx + 'px';
            marqueeEl.style.top = my + 'px';
            marqueeEl.style.width = mw + 'px';
            marqueeEl.style.height = mh + 'px';
            return;
        }

        if (!dragState) return;
        const dx = (e.clientX - dragState.startX) / zoomLevel;
        const dy = (e.clientY - dragState.startY) / zoomLevel;

        if (!dragState.pushed && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
            pushUndo();
            dragState.pushed = true;
        }

        const page = getCurrentPage();
        const widget = findWidgetById(dragState.widgetId, page.widgets);
        if (!widget) return;

        if (dragState.type === 'move') {
            widget.x = Math.max(0, Math.min(state.displayWidth - widget.width, dragState.origX + dx));
            widget.y = Math.max(0, Math.min(state.displayHeight - widget.height, dragState.origY + dy));
            renderCanvas();
        } else if (dragState.type === 'resize') {
            const dir = dragState.dir;
            let newX = dragState.origX, newY = dragState.origY;
            let newW = dragState.origW, newH = dragState.origH;

            if (dir.includes('e')) newW = Math.max(10, dragState.origW + dx);
            if (dir.includes('w')) { newW = Math.max(10, dragState.origW - dx); newX = dragState.origX + dx; }
            if (dir.includes('s')) newH = Math.max(10, dragState.origH + dy);
            if (dir.includes('n')) { newH = Math.max(10, dragState.origH - dy); newY = dragState.origY + dy; }

            widget.x = Math.max(0, newX);
            widget.y = Math.max(0, newY);
            widget.width = Math.min(newW, state.displayWidth - widget.x);
            widget.height = Math.min(newH, state.displayHeight - widget.y);
            renderCanvas();
        }
    }

    function onCanvasMouseUp(e) {
        // Handle marquee selection completion
        if (marqueeState) {
            const marqueeEl = document.getElementById('selection-marquee');
            if (marqueeEl) {
                const rect = canvasEl.getBoundingClientRect();
                const endX = (e.clientX - rect.left) / zoomLevel;
                const endY = (e.clientY - rect.top) / zoomLevel;

                const mx = Math.min(marqueeState.startX, endX);
                const my = Math.min(marqueeState.startY, endY);
                const mw = Math.abs(endX - marqueeState.startX);
                const mh = Math.abs(endY - marqueeState.startY);

                if (mw > 5 && mh > 5) {
                    const page = getCurrentPage();
                    multiSelectedIds = [];
                    for (const widget of page.widgets) {
                        if (widget.x + widget.width > mx && widget.x < mx + mw &&
                            widget.y + widget.height > my && widget.y < my + mh) {
                            multiSelectedIds.push(widget.id);
                        }
                    }
                    if (multiSelectedIds.length > 0) {
                        state.selectedWidgetId = multiSelectedIds[0];
                    }
                }
                marqueeEl.remove();
            }
            marqueeState = null;
            renderAll();
            return;
        }

        if (dragState && dragState.pushed) {
            notifyChange();
        }
        dragState = null;
    }

    function onCanvasDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }

    function onCanvasDrop(e) {
        e.preventDefault();
        const type = e.dataTransfer.getData('text/widget-type');
        if (!type) return;

        const rect = canvasEl.getBoundingClientRect();
        const x = Math.round((e.clientX - rect.left) / zoomLevel);
        const y = Math.round((e.clientY - rect.top) / zoomLevel);

        // Check if dropping onto a container widget
        let parentId = null;
        const targetWidgetEl = e.target.closest('.canvas-widget');
        if (targetWidgetEl) {
            const targetId = targetWidgetEl.dataset.widgetId;
            const page = getCurrentPage();
            const targetWidget = findWidgetById(targetId, page.widgets);
            if (targetWidget && LVGLWidgets.canContainChildren(targetWidget.type)) {
                parentId = targetId;
            }
        }

        const def = LVGLWidgets.getWidgetDef(type);
        const dropX = Math.max(0, Math.min(x - (def?.defaultSize.width || 50) / 2, state.displayWidth - (def?.defaultSize.width || 50)));
        const dropY = Math.max(0, Math.min(y - (def?.defaultSize.height || 25) / 2, state.displayHeight - (def?.defaultSize.height || 25)));

        createWidget(type, Math.round(dropX), Math.round(dropY), parentId);
    }

    // ---- Keyboard Shortcuts ----
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't intercept when typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if (e.target.closest('.CodeMirror')) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (state.selectedWidgetId) {
                    e.preventDefault();
                    deleteWidget(state.selectedWidgetId);
                }
            } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
                e.preventDefault();
                redo();
            } else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (state.selectedWidgetId) {
                    duplicateWidget(state.selectedWidgetId);
                }
            } else if (e.key === 'Escape') {
                state.selectedWidgetId = null;
                renderAll();
            }
            // Select All
            else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const page = getCurrentPage();
                multiSelectedIds = page.widgets.map(w => w.id);
                if (multiSelectedIds.length > 0) {
                    state.selectedWidgetId = multiSelectedIds[0];
                }
                renderAll();
            }
            // Arrow keys for nudging (works with multi-select)
            else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && state.selectedWidgetId) {
                e.preventDefault();
                const page = getCurrentPage();
                const step = e.shiftKey ? 10 : 1;
                const ids = multiSelectedIds.length > 0 ? multiSelectedIds :
                    (state.selectedWidgetId ? [state.selectedWidgetId] : []);
                if (ids.length > 0) {
                    pushUndo();
                    for (const id of ids) {
                        const widget = findWidgetById(id, page.widgets);
                        if (!widget) continue;
                        if (e.key === 'ArrowUp') widget.y = Math.max(0, widget.y - step);
                        if (e.key === 'ArrowDown') widget.y = Math.min(state.displayHeight - widget.height, widget.y + step);
                        if (e.key === 'ArrowLeft') widget.x = Math.max(0, widget.x - step);
                        if (e.key === 'ArrowRight') widget.x = Math.min(state.displayWidth - widget.width, widget.x + step);
                    }
                    renderCanvas();
                    renderProperties();
                    notifyChange();
                }
            }
        });
    }

    // ---- Rendering ----
    function renderAll() {
        renderPageTabs();
        renderCanvas();
        renderProperties();
        renderWidgetTree();
    }

    function renderPageTabs() {
        const tabsEl = document.getElementById('page-tabs');
        if (!tabsEl) return;
        tabsEl.innerHTML = '';
        state.pages.forEach((page, i) => {
            const tab = document.createElement('button');
            tab.className = `page-tab ${i === state.currentPageIndex ? 'active' : ''}`;
            tab.innerHTML = `${page.name}<span class="page-tab-close" data-page-index="${i}">&times;</span>`;
            tab.addEventListener('click', (e) => {
                if (e.target.classList.contains('page-tab-close')) {
                    removePage(parseInt(e.target.dataset.pageIndex));
                } else {
                    switchPage(i);
                }
            });
            tabsEl.appendChild(tab);
        });
    }

    function renderCanvas() {
        if (!canvasEl) return;
        canvasEl.innerHTML = '';
        const page = getCurrentPage();
        renderWidgetList(page.widgets, canvasEl);
    }

    function renderWidgetList(widgets, parentEl) {
        for (const widget of widgets) {
            const wrapperEl = document.createElement('div');
            let cls = 'canvas-widget';
            if (widget.id === state.selectedWidgetId) cls += ' selected';
            if (multiSelectedIds.includes(widget.id)) cls += ' multi-selected';
            wrapperEl.className = cls;
            wrapperEl.dataset.widgetId = widget.id;
            wrapperEl.style.left = widget.x + 'px';
            wrapperEl.style.top = widget.y + 'px';
            wrapperEl.style.width = widget.width + 'px';
            wrapperEl.style.height = widget.height + 'px';

            // Render widget visual
            const visualEl = LVGLRenderer.render(widget);
            wrapperEl.appendChild(visualEl);

            // Render children inside container widgets
            // Skip for widget types that render children internally (e.g. buttons show their label inline)
            const def = LVGLWidgets.getWidgetDef(widget.type);
            const rendersOwnChildren = widget.type === 'button';
            if (widget.children && widget.children.length > 0 && !rendersOwnChildren) {
                renderWidgetList(widget.children, wrapperEl);
            }

            // Add resize handles if selected
            if (widget.id === state.selectedWidgetId) {
                const dirs = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
                for (const dir of dirs) {
                    const handle = document.createElement('div');
                    handle.className = `resize-handle ${dir}`;
                    handle.dataset.dir = dir;
                    wrapperEl.appendChild(handle);
                }
            }

            parentEl.appendChild(wrapperEl);
        }
    }

    // ---- Properties Panel ----
    function renderProperties() {
        if (!propertiesPanel) return;
        const page = getCurrentPage();
        const widget = state.selectedWidgetId ? findWidgetById(state.selectedWidgetId, page.widgets) : null;
        const titleEl = document.getElementById('props-title');

        if (!widget) {
            propertiesPanel.innerHTML = '<div id="no-selection">Select a widget to edit its properties</div>';
            if (titleEl) titleEl.textContent = 'Properties';
            return;
        }

        if (titleEl) titleEl.textContent = `${widget.type} (${widget.id})`;
        const def = LVGLWidgets.getWidgetDef(widget.type);

        let html = '';

        // Identity section
        html += `<div class="prop-section">`;
        html += `<div class="prop-section-header expanded">Identity</div>`;
        html += `<div class="prop-section-body">`;
        html += propRow('ID', `<input type="text" value="${widget.id}" data-prop="id" readonly style="opacity:0.6">`);
        html += propRow('Type', `<span style="color:var(--accent)">${widget.type}</span>`);
        html += `</div></div>`;

        // Position & Size
        html += `<div class="prop-section">`;
        html += `<div class="prop-section-header expanded">Position & Size</div>`;
        html += `<div class="prop-section-body">`;
        html += propRow('X', numInput('x', widget.x));
        html += propRow('Y', numInput('y', widget.y));
        html += propRow('Width', numInput('width', widget.width, 10));
        html += propRow('Height', numInput('height', widget.height, 10));
        html += `</div></div>`;

        // Widget-specific properties
        if (def && Object.keys(def.properties).length > 0) {
            html += `<div class="prop-section">`;
            html += `<div class="prop-section-header expanded">Properties</div>`;
            html += `<div class="prop-section-body">`;
            for (const [key, propDef] of Object.entries(def.properties)) {
                let val = widget.properties[key] ?? propDef.default;
                // For button text, read from child label
                if (propDef.childLabel && widget.type === 'button') {
                    const childLabel = widget.children?.find(c => c.type === 'label');
                    val = childLabel?.properties?.text ?? propDef.default;
                }
                html += propRow(propDef.label || key, renderPropInput(key, propDef, val));
            }
            html += `</div></div>`;
        }

        // Style sections for each part
        if (def && def.parts) {
            const states = LVGLWidgets.STATE_STYLES || ['DEFAULT'];
            for (const part of def.parts) {
                const partStyles = widget.styles?.[part] || {};
                const partLabel = part.charAt(0).toUpperCase() + part.slice(1);

                // Main style group: background, border, general
                html += `<div class="prop-section">`;
                html += `<div class="prop-section-header${part === 'main' ? ' expanded' : ''}">${partLabel} Style</div>`;
                html += `<div class="prop-section-body">`;

                // State selector tabs
                if (states.length > 1) {
                    const selectedState = state._selectedStyleState?.[part] || 'DEFAULT';
                    html += `<div class="lvgl-state-tabs" style="display:flex;gap:2px;margin-bottom:8px;flex-wrap:wrap;">`;
                    for (const st of states) {
                        const stKey = st.toLowerCase();
                        const hasStyles = st === 'DEFAULT'
                            ? Object.keys(partStyles).some(k => k !== '_states')
                            : partStyles._states?.[stKey] && Object.keys(partStyles._states[stKey]).length > 0;
                        const isActive = st === selectedState;
                        html += `<button class="lvgl-state-tab${isActive ? ' active' : ''}${hasStyles ? ' has-styles' : ''}" `
                            + `data-state-part="${part}" data-state-name="${st}" `
                            + `style="font-size:10px;padding:2px 6px;border:1px solid var(--border-color);border-radius:3px;`
                            + `background:${isActive ? 'var(--accent-color)' : 'var(--bg-surface)'};`
                            + `color:${isActive ? '#fff' : 'var(--text-primary)'};cursor:pointer;`
                            + `${hasStyles && !isActive ? 'border-color:var(--accent-color);' : ''}">`
                            + `${st}</button>`;
                    }
                    html += `</div>`;
                }

                const currentState = state._selectedStyleState?.[part] || 'DEFAULT';
                const currentStyles = currentState === 'DEFAULT'
                    ? partStyles
                    : (partStyles._states?.[currentState.toLowerCase()] || {});

                const baseProps = ['bg_color', 'bg_opa', 'radius', 'border_color', 'border_width',
                                    'text_color', 'text_font', 'text_opa', 'text_letter_space',
                                    'opa', 'pad_all'];
                for (const prop of baseProps) {
                    const propDef = LVGLWidgets.STYLE_PROPS[prop];
                    if (!propDef) continue;
                    const val = currentStyles[prop] ?? '';
                    html += propRow(propDef.label, renderStyleInput(part, prop, propDef, val, currentState));
                }
                html += `</div></div>`;

                // Gradient group (only for main and indicator parts)
                if (part === 'main' || part === 'indicator') {
                    html += `<div class="prop-section">`;
                    html += `<div class="prop-section-header">${partLabel} Gradient</div>`;
                    html += `<div class="prop-section-body">`;
                    const gradProps = ['bg_grad_color', 'bg_grad_dir', 'bg_main_stop', 'bg_grad_stop', 'bg_dither_mode'];
                    for (const prop of gradProps) {
                        const propDef = LVGLWidgets.STYLE_PROPS[prop];
                        if (!propDef) continue;
                        const val = currentStyles[prop] ?? '';
                        html += propRow(propDef.label, renderStyleInput(part, prop, propDef, val, currentState));
                    }
                    html += `</div></div>`;
                }

                // Shadow / Glow group
                html += `<div class="prop-section">`;
                const isTextWidget = (widget.type === 'label' || widget.type === 'button');
                html += `<div class="prop-section-header">${partLabel} ${isTextWidget && part === 'main' ? 'Shadow / Glow' : 'Shadow'}</div>`;
                html += `<div class="prop-section-body">`;
                // Glow presets for text widgets
                if (isTextWidget && part === 'main') {
                    html += `<div class="prop-row"><span class="prop-label">Glow Preset</span><div class="prop-input">`;
                    html += `<select data-glow-preset="${part}">`;
                    html += `<option value="">(custom)</option>`;
                    html += `<option value="subtle">Subtle Glow</option>`;
                    html += `<option value="medium">Medium Glow</option>`;
                    html += `<option value="strong">Strong Glow</option>`;
                    html += `<option value="neon">Neon</option>`;
                    html += `<option value="none">None</option>`;
                    html += `</select></div></div>`;
                }
                const shadowProps = ['shadow_color', 'shadow_width', 'shadow_spread', 'shadow_opa', 'shadow_ofs_x', 'shadow_ofs_y'];
                for (const prop of shadowProps) {
                    const propDef = LVGLWidgets.STYLE_PROPS[prop];
                    if (!propDef) continue;
                    const val = currentStyles[prop] ?? '';
                    html += propRow(propDef.label, renderStyleInput(part, prop, propDef, val, currentState));
                }
                html += `</div></div>`;
            }
        }

        // Entity Binding section
        html += `<div class="prop-section">`;
        html += `<div class="prop-section-header${widget.binding ? ' expanded' : ''}">HA Entity Binding</div>`;
        html += `<div class="prop-section-body">`;
        if (widget.binding) {
            const entityName = typeof EntityBinding !== 'undefined'
                ? EntityBinding.getEntityName(widget.binding.entity_id)
                : widget.binding.entity_id;
            html += `<div style="margin:4px 6px;padding:6px;background:var(--bg-surface);border-radius:4px;font-size:11px">`;
            html += `<div style="color:#4caf50;font-weight:600;margin-bottom:4px">Bound</div>`;
            html += `<div style="color:var(--text-secondary)">${escapeHtml(entityName)}</div>`;
            html += `<div style="color:var(--text-muted);font-size:10px">${escapeHtml(widget.binding.entity_id)}</div>`;
            html += `<div style="color:var(--text-muted);font-size:10px;margin-top:2px">Role: ${escapeHtml(widget.binding.role)}</div>`;
            html += `<div style="margin-top:4px;display:flex;gap:4px">`;
            html += `<button onclick="AppActions.removeBinding('${widget.id}')" style="font-size:10px" class="btn-danger">Remove Binding</button>`;
            html += `</div></div>`;
        } else {
            html += `<div style="margin:6px;text-align:center">`;
            html += `<button onclick="AppActions.openEntityPicker('${widget.id}')" style="font-size:11px;width:100%">Bind to HA Entity</button>`;
            html += `</div>`;
        }
        html += `</div></div>`;

        // Conditions section
        const conditions = widget.conditions || [];
        html += `<div class="prop-section">`;
        html += `<div class="prop-section-header${conditions.length > 0 ? ' expanded' : ''}">Conditions</div>`;
        html += `<div class="prop-section-body">`;
        html += `<div style="margin:2px 6px;font-size:10px;color:var(--text-muted)">Change visibility or styles based on HA entity state</div>`;

        conditions.forEach((cond, ci) => {
            html += `<div class="condition-block" style="margin:4px 6px;padding:6px;background:var(--bg-surface);border-radius:4px;border-left:3px solid var(--accent);font-size:11px">`;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">`;
            html += `<span style="color:var(--accent);font-weight:600">Condition ${ci + 1}</span>`;
            html += `<button data-remove-condition="${ci}" style="padding:1px 5px;font-size:10px">&times;</button>`;
            html += `</div>`;

            // Entity source
            html += `<div class="prop-row"><span class="prop-label">Entity</span><div class="prop-input">`;
            html += `<input type="text" value="${escapeAttr(cond.entity_id || '')}" data-condition="${ci}" data-cond-field="entity_id" placeholder="entity.id or leave blank for binding">`;
            html += `</div></div>`;

            // Attribute (optional)
            html += `<div class="prop-row"><span class="prop-label">Attribute</span><div class="prop-input">`;
            html += `<input type="text" value="${escapeAttr(cond.attribute || '')}" data-condition="${ci}" data-cond-field="attribute" placeholder="(optional)">`;
            html += `</div></div>`;

            // Operator
            html += `<div class="prop-row"><span class="prop-label">When</span><div class="prop-input">`;
            html += `<select data-condition="${ci}" data-cond-field="operator">`;
            const ops = [
                { v: 'eq', l: 'equals' }, { v: 'neq', l: 'not equals' },
                { v: 'gt', l: '>' }, { v: 'lt', l: '<' },
                { v: 'gte', l: '>=' }, { v: 'lte', l: '<=' },
                { v: 'contains', l: 'contains' },
            ];
            for (const op of ops) {
                html += `<option value="${op.v}" ${cond.operator === op.v ? 'selected' : ''}>${op.l}</option>`;
            }
            html += `</select></div></div>`;

            // Value
            html += `<div class="prop-row"><span class="prop-label">Value</span><div class="prop-input">`;
            html += `<input type="text" value="${escapeAttr(cond.value || '')}" data-condition="${ci}" data-cond-field="value" placeholder="open, closed, 50, etc.">`;
            html += `</div></div>`;

            // Then action
            html += `<div class="prop-row"><span class="prop-label">Then</span><div class="prop-input">`;
            html += `<select data-condition="${ci}" data-cond-field="then_action">`;
            const actions = [
                { v: 'show', l: 'Show widget' }, { v: 'hide', l: 'Hide widget' },
                { v: 'enable', l: 'Enable' }, { v: 'disable', l: 'Disable' },
                { v: 'checked', l: 'Set checked' }, { v: 'unchecked', l: 'Set unchecked' },
                { v: 'style', l: 'Change style...' },
            ];
            for (const a of actions) {
                html += `<option value="${a.v}" ${cond.then_action === a.v ? 'selected' : ''}>${a.l}</option>`;
            }
            html += `</select></div></div>`;

            // Style overrides (shown when then_action is 'style')
            if (cond.then_action === 'style') {
                html += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--border-color)">`;
                html += `<div class="prop-row"><span class="prop-label">bg_color</span><div class="prop-input">`;
                html += `<input type="text" value="${escapeAttr(cond.style_bg_color || '')}" data-condition="${ci}" data-cond-field="style_bg_color" placeholder="0xFF0000">`;
                html += `</div></div>`;
                html += `<div class="prop-row"><span class="prop-label">bg_opa</span><div class="prop-input">`;
                html += `<input type="text" value="${escapeAttr(cond.style_bg_opa || '')}" data-condition="${ci}" data-cond-field="style_bg_opa" placeholder="COVER, 50%">`;
                html += `</div></div>`;
                html += `<div class="prop-row"><span class="prop-label">text_color</span><div class="prop-input">`;
                html += `<input type="text" value="${escapeAttr(cond.style_text_color || '')}" data-condition="${ci}" data-cond-field="style_text_color" placeholder="0x00FF00">`;
                html += `</div></div>`;
                html += `<div class="prop-row"><span class="prop-label">text</span><div class="prop-input">`;
                html += `<input type="text" value="${escapeAttr(cond.style_text || '')}" data-condition="${ci}" data-cond-field="style_text" placeholder="Custom text when true">`;
                html += `</div></div>`;
                html += `</div>`;
            }

            // Else action (optional)
            html += `<div class="prop-row"><span class="prop-label">Else</span><div class="prop-input">`;
            html += `<select data-condition="${ci}" data-cond-field="else_action">`;
            const elseActions = [
                { v: '', l: '(opposite)' },
                { v: 'show', l: 'Show widget' }, { v: 'hide', l: 'Hide widget' },
                { v: 'enable', l: 'Enable' }, { v: 'disable', l: 'Disable' },
                { v: 'checked', l: 'Set checked' }, { v: 'unchecked', l: 'Set unchecked' },
                { v: 'style', l: 'Change style...' },
            ];
            for (const a of elseActions) {
                html += `<option value="${a.v}" ${cond.else_action === a.v ? 'selected' : ''}>${a.l}</option>`;
            }
            html += `</select></div></div>`;

            // Else style overrides
            if (cond.else_action === 'style') {
                html += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--border-color)">`;
                html += `<div class="prop-row"><span class="prop-label">bg_color</span><div class="prop-input">`;
                html += `<input type="text" value="${escapeAttr(cond.else_style_bg_color || '')}" data-condition="${ci}" data-cond-field="else_style_bg_color" placeholder="0x808080">`;
                html += `</div></div>`;
                html += `<div class="prop-row"><span class="prop-label">bg_opa</span><div class="prop-input">`;
                html += `<input type="text" value="${escapeAttr(cond.else_style_bg_opa || '')}" data-condition="${ci}" data-cond-field="else_style_bg_opa" placeholder="COVER, 50%">`;
                html += `</div></div>`;
                html += `<div class="prop-row"><span class="prop-label">text_color</span><div class="prop-input">`;
                html += `<input type="text" value="${escapeAttr(cond.else_style_text_color || '')}" data-condition="${ci}" data-cond-field="else_style_text_color" placeholder="0xFFFFFF">`;
                html += `</div></div>`;
                html += `<div class="prop-row"><span class="prop-label">text</span><div class="prop-input">`;
                html += `<input type="text" value="${escapeAttr(cond.else_style_text || '')}" data-condition="${ci}" data-cond-field="else_style_text" placeholder="Custom text when false">`;
                html += `</div></div>`;
                html += `</div>`;
            }

            html += `</div>`;
        });

        html += `<div style="margin:6px;text-align:center">`;
        html += `<button id="btn-add-condition" style="font-size:11px;width:100%">+ Add Condition</button>`;
        html += `</div>`;
        html += `</div></div>`;

        // Events section
        const applicableEvents = LVGLWidgets.getEventsForWidget(widget.type);
        html += `<div class="prop-section">`;
        html += `<div class="prop-section-header">Events / Actions</div>`;
        html += `<div class="prop-section-body">`;

        // Show existing events
        if (widget.events) {
            for (const [eventName, actions] of Object.entries(widget.events)) {
                if (!actions || actions.length === 0) continue;
                html += `<div style="margin:4px 0 2px 6px;font-size:11px;color:var(--accent);font-weight:600">${eventName}</div>`;
                actions.forEach((action, ai) => {
                    const actionDef = LVGLWidgets.ACTION_TYPES[action.type];
                    html += `<div style="margin:2px 6px;padding:6px;background:var(--bg-surface);border-radius:4px;font-size:11px">`;
                    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">`;
                    html += `<span style="color:var(--text-secondary);font-weight:600">${actionDef?.label || action.type}</span>`;
                    html += `<button data-remove-action="${eventName}:${ai}" style="padding:1px 5px;font-size:10px">&times;</button>`;
                    html += `</div>`;
                    if (actionDef) {
                        for (const [fKey, fDef] of Object.entries(actionDef.fields)) {
                            const fVal = action.fields?.[fKey] ?? '';
                            html += `<div class="prop-row"><span class="prop-label">${fDef.label || fKey}</span><div class="prop-input">`;
                            if (fDef.type === 'text' || fDef.type === 'yaml_map') {
                                html += `<textarea data-event-field="${eventName}:${ai}:${fKey}" rows="2">${escapeHtml(fVal)}</textarea>`;
                            } else if (fDef.type === 'enum' && fDef.options) {
                                html += `<select data-event-field="${eventName}:${ai}:${fKey}">`;
                                for (const o of fDef.options) {
                                    html += `<option value="${o}" ${o === fVal ? 'selected' : ''}>${o || '(none)'}</option>`;
                                }
                                html += `</select>`;
                            } else {
                                html += `<input type="text" value="${escapeAttr(String(fVal))}" data-event-field="${eventName}:${ai}:${fKey}">`;
                            }
                            html += `</div></div>`;
                        }
                    }
                    html += `</div>`;
                });
            }
        }

        // Add event button
        const eventOpts = Object.entries(applicableEvents).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
        const actionOpts = Object.entries(LVGLWidgets.ACTION_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
        html += `<div style="margin:6px;display:flex;flex-direction:column;gap:4px">`;
        html += `<div style="display:flex;gap:4px"><select id="add-event-select" style="flex:1;font-size:10px">${eventOpts}</select>`;
        html += `<select id="add-action-select" style="flex:1;font-size:10px">${actionOpts}</select></div>`;
        html += `<button id="btn-add-event-action" style="font-size:11px">+ Add Action</button>`;
        html += `</div>`;
        html += `</div></div>`;

        propertiesPanel.innerHTML = html;
        attachPropertyEvents();
    }

    function propRow(label, inputHtml) {
        return `<div class="prop-row"><span class="prop-label" title="${label}">${label}</span><div class="prop-input">${inputHtml}</div></div>`;
    }

    function numInput(prop, value, min) {
        return `<input type="number" value="${value}" data-prop="${prop}" ${min !== undefined ? `min="${min}"` : ''}>`;
    }

    function renderPropInput(key, propDef, value) {
        switch (propDef.type) {
            case 'string':
                return `<input type="text" value="${escapeAttr(value || '')}" data-widget-prop="${key}">`;
            case 'number':
                return `<input type="number" value="${value ?? ''}" data-widget-prop="${key}" ${propDef.min !== undefined ? `min="${propDef.min}"` : ''} ${propDef.max !== undefined ? `max="${propDef.max}"` : ''}>`;
            case 'boolean':
                return `<input type="checkbox" ${value ? 'checked' : ''} data-widget-prop="${key}">`;
            case 'color':
                const colorVal = LVGLRenderer.parseColor(value) || '#000000';
                return `<div class="prop-color-row"><input type="color" value="${colorVal}" data-widget-prop="${key}" data-color-picker="true"><input type="text" value="${escapeAttr(value || '')}" data-widget-prop="${key}"></div>`;
            case 'enum':
                let opts = (propDef.options || []).map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o || '(none)'}</option>`).join('');
                return `<select data-widget-prop="${key}">${opts}</select>`;
            case 'text':
                return `<textarea data-widget-prop="${key}" rows="3">${escapeHtml(value || '')}</textarea>`;
            case 'opacity':
                return `<input type="text" value="${value ?? ''}" data-widget-prop="${key}" placeholder="0-100% or TRANSP/COVER">`;
            case 'size':
                return `<input type="text" value="${value ?? ''}" data-widget-prop="${key}" placeholder="px or %">`;
            default:
                return `<input type="text" value="${escapeAttr(String(value ?? ''))}" data-widget-prop="${key}">`;
        }
    }

    function renderStyleInput(part, prop, propDef, value, lvglState) {
        const stateAttr = lvglState ? ` data-style-state="${lvglState}"` : '';
        const dataAttr = `data-style-part="${part}" data-style-prop="${prop}"${stateAttr}`;

        // Special rendering for text_font — show font dropdown
        if (prop === 'text_font') {
            return renderFontSelector(dataAttr, value);
        }

        switch (propDef.type) {
            case 'color':
                const colorVal = LVGLRenderer.parseColor(value) || '#000000';
                return `<div class="prop-color-row"><input type="color" value="${colorVal}" ${dataAttr} data-color-picker="true"><input type="text" value="${escapeAttr(value || '')}" ${dataAttr}></div>`;
            case 'number':
                return `<input type="number" value="${value ?? ''}" ${dataAttr} ${propDef.min !== undefined ? `min="${propDef.min}"` : ''}>`;
            case 'opacity':
                return `<input type="text" value="${value ?? ''}" ${dataAttr} placeholder="0-100% or TRANSP/COVER">`;
            case 'boolean':
                return `<input type="checkbox" ${value ? 'checked' : ''} ${dataAttr}>`;
            case 'enum':
                let opts = (propDef.options || []).map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o || '(none)'}</option>`).join('');
                return `<select ${dataAttr}>${opts}</select>`;
            default:
                return `<input type="text" value="${escapeAttr(String(value ?? ''))}" ${dataAttr}>`;
        }
    }

    function renderFontSelector(dataAttr, value) {
        const fonts = FontManager.getAllFonts();
        const builtinFonts = FontManager.getBuiltinFonts();
        const projectFonts = FontManager.getProjectFonts();
        let opts = `<option value="" ${!value ? 'selected' : ''}>(default)</option>`;

        if (projectFonts.length > 0) {
            opts += '<optgroup label="Project Fonts">';
            for (const f of projectFonts) {
                opts += `<option value="${f.id}" ${f.id === value ? 'selected' : ''}>${f.label || f.id} (${f.size}px)</option>`;
            }
            opts += '</optgroup>';
        }

        opts += '<optgroup label="Built-in (LVGL)">';
        for (const f of builtinFonts) {
            opts += `<option value="${f.id}" ${f.id === value ? 'selected' : ''}>${f.label}</option>`;
        }
        opts += '</optgroup>';

        // Check if current value is a custom string not in our font lists
        const isCustom = value && !fonts.some(f => f.id === value);
        if (isCustom) {
            opts = `<option value="${escapeAttr(value)}" selected>${value}</option>` + opts;
        }

        let html = `<div class="font-selector-row">`;
        html += `<select ${dataAttr} class="font-select">${opts}</select>`;
        html += `<button class="font-manage-btn" title="Manage Fonts" data-action="manage-fonts">F</button>`;
        html += `</div>`;
        return html;
    }

    function attachPropertyEvents() {
        if (!propertiesPanel) return;

        // Position/size props
        propertiesPanel.querySelectorAll('[data-prop]').forEach(input => {
            input.addEventListener('change', (e) => {
                const prop = e.target.dataset.prop;
                if (prop === 'id') return;
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                    updateWidgetProperty(state.selectedWidgetId, prop, val);
                }
            });
        });

        // Widget properties
        propertiesPanel.querySelectorAll('[data-widget-prop]').forEach(input => {
            if (input.dataset.colorPicker) return; // handled separately
            const handler = (e) => {
                const key = e.target.dataset.widgetProp;
                let val;
                if (e.target.type === 'checkbox') {
                    val = e.target.checked;
                } else if (e.target.type === 'number') {
                    val = e.target.value === '' ? null : parseFloat(e.target.value);
                } else {
                    val = e.target.value;
                }
                updateWidgetProperty(state.selectedWidgetId, key, val);
            };
            input.addEventListener('change', handler);
            if (input.tagName === 'TEXTAREA') input.addEventListener('input', handler);
        });

        // Color picker sync
        propertiesPanel.querySelectorAll('[data-color-picker]').forEach(picker => {
            picker.addEventListener('input', (e) => {
                // Find sibling text input
                const textInput = picker.parentElement.querySelector('input[type="text"]');
                if (textInput) {
                    textInput.value = e.target.value;
                    textInput.dispatchEvent(new Event('change'));
                }
            });
        });

        // Style properties
        propertiesPanel.querySelectorAll('[data-style-part]').forEach(input => {
            if (input.dataset.colorPicker) return;
            const handler = (e) => {
                const part = e.target.dataset.stylePart;
                const prop = e.target.dataset.styleProp;
                const lvglState = e.target.dataset.styleState || 'DEFAULT';
                let val;
                if (e.target.type === 'checkbox') {
                    val = e.target.checked;
                } else if (e.target.type === 'number') {
                    val = e.target.value === '' ? null : parseFloat(e.target.value);
                } else {
                    val = e.target.value || null;
                }
                updateWidgetStyle(state.selectedWidgetId, part, prop, val, lvglState);
            };
            input.addEventListener('change', handler);
        });

        // State tab buttons
        propertiesPanel.querySelectorAll('.lvgl-state-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const part = e.target.dataset.statePart;
                const stateName = e.target.dataset.stateName;
                if (!state._selectedStyleState) state._selectedStyleState = {};
                state._selectedStyleState[part] = stateName;
                renderProperties();
            });
        });

        // Font manage buttons
        propertiesPanel.querySelectorAll('[data-action="manage-fonts"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                FontManager.showModal();
            });
        });

        // Glow preset selectors
        propertiesPanel.querySelectorAll('[data-glow-preset]').forEach(sel => {
            sel.addEventListener('change', (e) => {
                const part = e.target.dataset.glowPreset;
                const preset = e.target.value;
                if (!preset || !state.selectedWidgetId) return;
                const widget = findWidgetById(state.selectedWidgetId, getCurrentPage().widgets);
                if (!widget) return;

                pushUndo();
                if (!widget.styles[part]) widget.styles[part] = {};
                const s = widget.styles[part];

                // Read current text_color as default glow color
                const textColor = s.text_color || '#00ccff';

                if (preset === 'none') {
                    delete s.shadow_color;
                    delete s.shadow_width;
                    delete s.shadow_spread;
                    delete s.shadow_opa;
                    delete s.shadow_ofs_x;
                    delete s.shadow_ofs_y;
                } else if (preset === 'subtle') {
                    s.shadow_color = textColor;
                    s.shadow_width = 4;
                    s.shadow_spread = 1;
                    delete s.shadow_opa;
                    s.shadow_ofs_x = 0;
                    s.shadow_ofs_y = 0;
                } else if (preset === 'medium') {
                    s.shadow_color = textColor;
                    s.shadow_width = 8;
                    s.shadow_spread = 2;
                    delete s.shadow_opa;
                    s.shadow_ofs_x = 0;
                    s.shadow_ofs_y = 0;
                } else if (preset === 'strong') {
                    s.shadow_color = textColor;
                    s.shadow_width = 16;
                    s.shadow_spread = 4;
                    delete s.shadow_opa;
                    s.shadow_ofs_x = 0;
                    s.shadow_ofs_y = 0;
                } else if (preset === 'neon') {
                    s.shadow_color = textColor;
                    s.shadow_width = 24;
                    s.shadow_spread = 8;
                    delete s.shadow_opa;
                    s.shadow_ofs_x = 0;
                    s.shadow_ofs_y = 0;
                }

                renderAll();
            });
        });

        // Section header toggles
        propertiesPanel.querySelectorAll('.prop-section-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('expanded');
                header.classList.toggle('collapsed');
                const body = header.nextElementSibling;
                if (body) body.style.display = header.classList.contains('collapsed') ? 'none' : '';
            });
        });

        // Event action fields
        propertiesPanel.querySelectorAll('[data-event-field]').forEach(input => {
            const handler = (e) => {
                const [eventName, aiStr, fieldName] = e.target.dataset.eventField.split(':');
                updateEventAction(state.selectedWidgetId, eventName, parseInt(aiStr), fieldName, e.target.value);
            };
            input.addEventListener('change', handler);
            if (input.tagName === 'TEXTAREA') input.addEventListener('input', handler);
        });

        // Remove action buttons
        propertiesPanel.querySelectorAll('[data-remove-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const [eventName, aiStr] = e.target.dataset.removeAction.split(':');
                removeEventAction(state.selectedWidgetId, eventName, parseInt(aiStr));
            });
        });

        // Add event action button
        const addBtn = document.getElementById('btn-add-event-action');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                const eventSel = document.getElementById('add-event-select');
                const actionSel = document.getElementById('add-action-select');
                if (eventSel && actionSel && state.selectedWidgetId) {
                    addEventAction(state.selectedWidgetId, eventSel.value, actionSel.value);
                }
            });
        }

        // Condition fields
        propertiesPanel.querySelectorAll('[data-condition]').forEach(input => {
            const handler = (e) => {
                const ci = parseInt(e.target.dataset.condition);
                const field = e.target.dataset.condField;
                const page = getCurrentPage();
                const widget = findWidgetById(state.selectedWidgetId, page.widgets);
                if (!widget || !widget.conditions || !widget.conditions[ci]) return;
                pushUndo();
                widget.conditions[ci][field] = e.target.value;
                // Re-render if action type changed (to show/hide style fields)
                if (field === 'then_action' || field === 'else_action') {
                    renderProperties();
                }
                notifyChange();
            };
            input.addEventListener('change', handler);
        });

        // Remove condition buttons
        propertiesPanel.querySelectorAll('[data-remove-condition]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const ci = parseInt(e.target.dataset.removeCondition);
                const page = getCurrentPage();
                const widget = findWidgetById(state.selectedWidgetId, page.widgets);
                if (!widget || !widget.conditions) return;
                pushUndo();
                widget.conditions.splice(ci, 1);
                renderProperties();
                notifyChange();
            });
        });

        // Add condition button
        const addCondBtn = document.getElementById('btn-add-condition');
        if (addCondBtn) {
            addCondBtn.addEventListener('click', () => {
                const page = getCurrentPage();
                const widget = findWidgetById(state.selectedWidgetId, page.widgets);
                if (!widget) return;
                pushUndo();
                if (!widget.conditions) widget.conditions = [];
                const defaultEntity = widget.binding ? widget.binding.entity_id : '';
                widget.conditions.push({
                    entity_id: defaultEntity,
                    attribute: '',
                    operator: 'eq',
                    value: '',
                    then_action: 'show',
                    else_action: '',
                    style_bg_color: '', style_bg_opa: '', style_text_color: '', style_text: '',
                    else_style_bg_color: '', else_style_bg_opa: '', else_style_text_color: '', else_style_text: '',
                });
                renderProperties();
                notifyChange();
            });
        }
    }

    // ---- Zoom Controls ----
    function setupZoomControls() {
        const zoomInBtn = document.getElementById('btn-zoom-in');
        const zoomOutBtn = document.getElementById('btn-zoom-out');
        const zoomFitBtn = document.getElementById('btn-zoom-fit');
        const zoomLabel = document.getElementById('canvas-zoom-label');

        if (zoomInBtn) zoomInBtn.addEventListener('click', () => setZoom(zoomLevel + ZOOM_STEP));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => setZoom(zoomLevel - ZOOM_STEP));
        if (zoomLabel) zoomLabel.addEventListener('click', () => setZoom(1));
        if (zoomFitBtn) zoomFitBtn.addEventListener('click', zoomToFit);

        // Mouse wheel zoom
        const wrapper = document.getElementById('canvas-wrapper');
        if (wrapper) {
            wrapper.addEventListener('wheel', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
                    setZoom(zoomLevel + delta);
                }
            }, { passive: false });
        }
    }

    function setZoom(level) {
        zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(level * 100) / 100));
        if (canvasScaleWrapper) {
            canvasScaleWrapper.style.transform = `scale(${zoomLevel})`;
        }
        const label = document.getElementById('canvas-zoom-label');
        if (label) label.textContent = Math.round(zoomLevel * 100) + '%';
    }

    function zoomToFit() {
        const wrapper = document.getElementById('canvas-wrapper');
        if (!wrapper) return;
        const wrapperRect = wrapper.getBoundingClientRect();
        const padded = 40;
        const scaleX = (wrapperRect.width - padded) / state.displayWidth;
        const scaleY = (wrapperRect.height - padded) / state.displayHeight;
        setZoom(Math.min(scaleX, scaleY, ZOOM_MAX));
    }

    // ---- Alignment Tools ----
    function setupAlignToolbar() {
        const toolbar = document.getElementById('align-toolbar');
        if (!toolbar) return;
        toolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-align]');
            if (!btn) return;
            const action = btn.dataset.align;
            alignWidgets(action);
        });
    }

    function getAlignableWidgets() {
        const page = getCurrentPage();
        if (multiSelectedIds.length >= 2) {
            return multiSelectedIds.map(id => findWidgetById(id, page.widgets)).filter(Boolean);
        }
        if (state.selectedWidgetId) {
            return [findWidgetById(state.selectedWidgetId, page.widgets)].filter(Boolean);
        }
        return [];
    }

    function alignWidgets(action) {
        const widgets = getAlignableWidgets();
        if (widgets.length === 0) return;

        pushUndo();

        // Single widget: align relative to canvas
        if (widgets.length === 1) {
            const w = widgets[0];
            switch (action) {
                case 'left': w.x = 0; break;
                case 'center-h': w.x = Math.round((state.displayWidth - w.width) / 2); break;
                case 'right': w.x = state.displayWidth - w.width; break;
                case 'top': w.y = 0; break;
                case 'center-v': w.y = Math.round((state.displayHeight - w.height) / 2); break;
                case 'bottom': w.y = state.displayHeight - w.height; break;
            }
        } else {
            // Multiple widgets: align relative to each other
            const bounds = {
                left: Math.min(...widgets.map(w => w.x)),
                right: Math.max(...widgets.map(w => w.x + w.width)),
                top: Math.min(...widgets.map(w => w.y)),
                bottom: Math.max(...widgets.map(w => w.y + w.height)),
            };
            bounds.centerX = Math.round((bounds.left + bounds.right) / 2);
            bounds.centerY = Math.round((bounds.top + bounds.bottom) / 2);

            switch (action) {
                case 'left':
                    widgets.forEach(w => w.x = bounds.left);
                    break;
                case 'center-h':
                    widgets.forEach(w => w.x = bounds.centerX - Math.round(w.width / 2));
                    break;
                case 'right':
                    widgets.forEach(w => w.x = bounds.right - w.width);
                    break;
                case 'top':
                    widgets.forEach(w => w.y = bounds.top);
                    break;
                case 'center-v':
                    widgets.forEach(w => w.y = bounds.centerY - Math.round(w.height / 2));
                    break;
                case 'bottom':
                    widgets.forEach(w => w.y = bounds.bottom - w.height);
                    break;
                case 'distribute-h': {
                    if (widgets.length < 3) break;
                    const sorted = [...widgets].sort((a, b) => a.x - b.x);
                    const totalSpace = bounds.right - bounds.left - sorted.reduce((s, w) => s + w.width, 0);
                    const gap = totalSpace / (sorted.length - 1);
                    let curX = sorted[0].x + sorted[0].width;
                    for (let i = 1; i < sorted.length - 1; i++) {
                        sorted[i].x = Math.round(curX + gap);
                        curX = sorted[i].x + sorted[i].width;
                    }
                    break;
                }
                case 'distribute-v': {
                    if (widgets.length < 3) break;
                    const sorted = [...widgets].sort((a, b) => a.y - b.y);
                    const totalSpace = bounds.bottom - bounds.top - sorted.reduce((s, w) => s + w.height, 0);
                    const gap = totalSpace / (sorted.length - 1);
                    let curY = sorted[0].y + sorted[0].height;
                    for (let i = 1; i < sorted.length - 1; i++) {
                        sorted[i].y = Math.round(curY + gap);
                        curY = sorted[i].y + sorted[i].height;
                    }
                    break;
                }
            }
        }

        renderAll();
        notifyChange();
    }

    // ---- Right Panel Resize ----
    function setupRightPanelResize() {
        const handle = document.getElementById('right-resize-handle');
        const panel = document.getElementById('panel-right');
        if (!handle || !panel) return;

        let resizing = false;
        let startX = 0;
        let startWidth = 0;

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            resizing = true;
            startX = e.clientX;
            startWidth = panel.offsetWidth;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!resizing) return;
            const dx = startX - e.clientX;
            const newWidth = Math.max(180, Math.min(600, startWidth + dx));
            panel.style.width = newWidth + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (resizing) {
                resizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    // ---- Widget Tree ----
    let draggedWidgetId = null;
    let dragOverNodeEl = null;
    let dropPosition = null; // 'before', 'after', or 'inside'

    function renderWidgetTree() {
        if (!widgetTreeEl) return;
        const page = getCurrentPage();
        widgetTreeEl.innerHTML = '';
        renderTreeNodes(page.widgets, widgetTreeEl, page.widgets);
    }

    function renderTreeNodes(widgets, parentEl, parentArray) {
        for (let idx = 0; idx < widgets.length; idx++) {
            const widget = widgets[idx];
            const node = document.createElement('div');
            node.className = 'tree-node';
            node.dataset.widgetId = widget.id;

            const header = document.createElement('div');
            header.className = `tree-node-header ${widget.id === state.selectedWidgetId ? 'selected' : ''}`;
            header.draggable = true;

            const toggle = document.createElement('span');
            toggle.className = 'tree-node-toggle';
            toggle.textContent = widget.children && widget.children.length > 0 ? '▾' : '';

            const def = LVGLWidgets.getWidgetDef(widget.type);
            const icon = document.createElement('span');
            icon.className = 'tree-node-icon';
            icon.textContent = def?.icon || '?';

            const label = document.createElement('span');
            label.className = 'tree-node-label';
            label.textContent = widget.id;

            const type = document.createElement('span');
            type.className = 'tree-node-type';
            type.textContent = widget.type;

            header.appendChild(toggle);
            header.appendChild(icon);
            header.appendChild(label);
            header.appendChild(type);

            // Drag-and-drop handlers
            header.addEventListener('dragstart', (e) => {
                draggedWidgetId = widget.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', widget.id);
                header.classList.add('dragging');
                setTimeout(() => header.style.opacity = '0.4', 0);
            });

            header.addEventListener('dragend', () => {
                header.style.opacity = '';
                header.classList.remove('dragging');
                clearDropIndicators();
                draggedWidgetId = null;
                dragOverNodeEl = null;
                dropPosition = null;
            });

            header.addEventListener('dragover', (e) => {
                if (!draggedWidgetId || draggedWidgetId === widget.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';

                const rect = header.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const height = rect.height;

                clearDropIndicators();

                const canHaveChildren = def && def.canContain;
                if (canHaveChildren && y > height * 0.25 && y < height * 0.75) {
                    dropPosition = 'inside';
                    header.classList.add('drop-inside');
                } else if (y < height / 2) {
                    dropPosition = 'before';
                    header.classList.add('drop-before');
                } else {
                    dropPosition = 'after';
                    header.classList.add('drop-after');
                }
                dragOverNodeEl = header;
            });

            header.addEventListener('dragleave', () => {
                header.classList.remove('drop-before', 'drop-after', 'drop-inside');
            });

            header.addEventListener('drop', (e) => {
                e.preventDefault();
                if (!draggedWidgetId || draggedWidgetId === widget.id) return;

                const page = getCurrentPage();
                // Check we're not dropping a parent into its own child
                if (isDescendant(draggedWidgetId, widget.id, page.widgets)) return;

                pushUndo();

                // Remove the dragged widget from its current location
                const draggedWidget = findWidgetById(draggedWidgetId, page.widgets);
                if (!draggedWidget) return;
                removeWidgetFromTree(draggedWidgetId, page.widgets);

                // Find the target widget's parent array and index
                const targetInfo = findWidgetParentArray(widget.id, page.widgets);
                if (!targetInfo) return;

                if (dropPosition === 'inside') {
                    if (!widget.children) widget.children = [];
                    widget.children.push(draggedWidget);
                } else if (dropPosition === 'before') {
                    targetInfo.array.splice(targetInfo.index, 0, draggedWidget);
                } else {
                    targetInfo.array.splice(targetInfo.index + 1, 0, draggedWidget);
                }

                clearDropIndicators();
                draggedWidgetId = null;
                renderAll();
                notifyChange();
            });

            header.addEventListener('click', () => {
                state.selectedWidgetId = widget.id;
                renderAll();
                // Navigate YAML editor to this widget
                if (typeof YAMLEngine !== 'undefined' && YAMLEngine.scrollToWidget) {
                    YAMLEngine.scrollToWidget(widget.id);
                }
            });

            node.appendChild(header);

            if (widget.children && widget.children.length > 0) {
                const childrenEl = document.createElement('div');
                childrenEl.className = 'tree-node-children';
                renderTreeNodes(widget.children, childrenEl, widget.children);
                node.appendChild(childrenEl);
            }

            parentEl.appendChild(node);
        }
    }

    function clearDropIndicators() {
        if (!widgetTreeEl) return;
        widgetTreeEl.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach(el => {
            el.classList.remove('drop-before', 'drop-after', 'drop-inside');
        });
    }

    function isDescendant(parentId, childId, widgets) {
        const parent = findWidgetById(parentId, widgets);
        if (!parent || !parent.children) return false;
        for (const c of parent.children) {
            if (c.id === childId) return true;
            if (c.children && isDescendant(c.id, childId, [c])) return true;
        }
        return false;
    }

    function findWidgetParentArray(widgetId, widgets) {
        for (let i = 0; i < widgets.length; i++) {
            if (widgets[i].id === widgetId) {
                return { array: widgets, index: i };
            }
            if (widgets[i].children) {
                const found = findWidgetParentArray(widgetId, widgets[i].children);
                if (found) return found;
            }
        }
        return null;
    }

    // ---- State Change Notification ----
    function notifyChange() {
        if (onStateChange) {
            onStateChange(getState());
        }
    }

    // ---- State Getters/Setters ----
    function getState() {
        return {
            pages: state.pages,
            currentPageIndex: state.currentPageIndex,
            displayWidth: state.displayWidth,
            displayHeight: state.displayHeight,
        };
    }

    function setState(newState) {
        pushUndo();
        if (newState.pages) state.pages = newState.pages;
        if (newState.currentPageIndex !== undefined) state.currentPageIndex = newState.currentPageIndex;
        if (newState.displayWidth) setDisplaySize(newState.displayWidth, newState.displayHeight || state.displayHeight);
        state.selectedWidgetId = null;
        // Ensure nextId is higher than any existing IDs
        syncNextId();
        renderAll();
    }

    function syncNextId() {
        let maxId = 0;
        function walk(widgets) {
            for (const w of widgets) {
                const match = w.id.match(/_(\d+)$/);
                if (match) maxId = Math.max(maxId, parseInt(match[1]));
                if (w.children) walk(w.children);
            }
        }
        for (const page of state.pages) walk(page.widgets);
        state.nextId = maxId + 1;
    }

    // ---- Helpers ----
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ---- Public API ----
    return {
        init,
        getState,
        setState,
        setDisplaySize,
        createWidget,
        deleteWidget,
        duplicateWidget,
        updateWidgetProperty,
        updateWidgetStyle,
        addEventAction,
        updateEventAction,
        removeEventAction,
        undo,
        redo,
        addPage,
        removePage,
        switchPage,
        getCurrentPage,
        findWidgetById,
        renderAll,
        get selectedWidgetId() { return state.selectedWidgetId; },
        set selectedWidgetId(id) { state.selectedWidgetId = id; multiSelectedIds = []; renderAll(); },
        get multiSelectedIds() { return multiSelectedIds; },
        alignWidgets,
        setZoom,
        findWidgetParentArray,
    };
})();
