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
    let propertiesPanel = null;
    let widgetTreeEl = null;
    let onStateChange = null; // callback for YAML sync

    // ---- Initialization ----
    function init(options = {}) {
        canvasEl = document.getElementById('canvas');
        propertiesPanel = document.getElementById('properties-panel');
        widgetTreeEl = document.getElementById('widget-tree');
        onStateChange = options.onStateChange || null;

        setDisplaySize(state.displayWidth, state.displayHeight);
        setupCanvasEvents();
        setupKeyboardShortcuts();
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
        } else {
            widget.properties[key] = value;
        }
        renderAll();
        notifyChange();
    }

    function updateWidgetStyle(widgetId, part, prop, value) {
        const page = getCurrentPage();
        const widget = findWidgetById(widgetId, page.widgets);
        if (!widget) return;

        pushUndo();
        if (!widget.styles) widget.styles = {};
        if (!widget.styles[part]) widget.styles[part] = {};
        if (value === null || value === '' || value === undefined) {
            delete widget.styles[part][prop];
        } else {
            widget.styles[part][prop] = value;
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
        if (e.target === canvasEl) {
            state.selectedWidgetId = null;
            renderAll();
        }
    }

    function onCanvasMouseDown(e) {
        const widgetEl = e.target.closest('.canvas-widget');
        if (!widgetEl) return;

        const widgetId = widgetEl.dataset.widgetId;
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
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;

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
        const x = Math.round(e.clientX - rect.left);
        const y = Math.round(e.clientY - rect.top);

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
            // Arrow keys for nudging
            else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && state.selectedWidgetId) {
                e.preventDefault();
                const page = getCurrentPage();
                const widget = findWidgetById(state.selectedWidgetId, page.widgets);
                if (widget) {
                    const step = e.shiftKey ? 10 : 1;
                    pushUndo();
                    if (e.key === 'ArrowUp') widget.y = Math.max(0, widget.y - step);
                    if (e.key === 'ArrowDown') widget.y = Math.min(state.displayHeight - widget.height, widget.y + step);
                    if (e.key === 'ArrowLeft') widget.x = Math.max(0, widget.x - step);
                    if (e.key === 'ArrowRight') widget.x = Math.min(state.displayWidth - widget.width, widget.x + step);
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
            wrapperEl.className = `canvas-widget ${widget.id === state.selectedWidgetId ? 'selected' : ''}`;
            wrapperEl.dataset.widgetId = widget.id;
            wrapperEl.style.left = widget.x + 'px';
            wrapperEl.style.top = widget.y + 'px';
            wrapperEl.style.width = widget.width + 'px';
            wrapperEl.style.height = widget.height + 'px';

            // Render widget visual
            const visualEl = LVGLRenderer.render(widget);
            wrapperEl.appendChild(visualEl);

            // Render children inside container widgets
            if (widget.children && widget.children.length > 0) {
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
                const val = widget.properties[key] ?? propDef.default;
                html += propRow(propDef.label || key, renderPropInput(key, propDef, val));
            }
            html += `</div></div>`;
        }

        // Style sections for each part
        if (def && def.parts) {
            for (const part of def.parts) {
                html += `<div class="prop-section">`;
                html += `<div class="prop-section-header${part === 'main' ? ' expanded' : ''}">${part.charAt(0).toUpperCase() + part.slice(1)} Style</div>`;
                html += `<div class="prop-section-body">`;

                const partStyles = widget.styles?.[part] || {};

                // Show commonly used style props
                const commonProps = ['bg_color', 'bg_opa', 'radius', 'border_color', 'border_width',
                                    'text_color', 'opa', 'pad_all', 'shadow_color', 'shadow_width'];
                for (const prop of commonProps) {
                    const propDef = LVGLWidgets.STYLE_PROPS[prop];
                    if (!propDef) continue;
                    const val = partStyles[prop] ?? '';
                    html += propRow(propDef.label, renderStyleInput(part, prop, propDef, val));
                }
                html += `</div></div>`;
            }
        }

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
                return `<input type="text" value="${value ?? ''}" data-widget-prop="${key}" placeholder="0-255 or TRANSP/COVER">`;
            case 'size':
                return `<input type="text" value="${value ?? ''}" data-widget-prop="${key}" placeholder="px or %">`;
            default:
                return `<input type="text" value="${escapeAttr(String(value ?? ''))}" data-widget-prop="${key}">`;
        }
    }

    function renderStyleInput(part, prop, propDef, value) {
        const dataAttr = `data-style-part="${part}" data-style-prop="${prop}"`;
        switch (propDef.type) {
            case 'color':
                const colorVal = LVGLRenderer.parseColor(value) || '#000000';
                return `<div class="prop-color-row"><input type="color" value="${colorVal}" ${dataAttr} data-color-picker="true"><input type="text" value="${escapeAttr(value || '')}" ${dataAttr}></div>`;
            case 'number':
                return `<input type="number" value="${value ?? ''}" ${dataAttr} ${propDef.min !== undefined ? `min="${propDef.min}"` : ''}>`;
            case 'opacity':
                return `<input type="text" value="${value ?? ''}" ${dataAttr} placeholder="0-255 or TRANSP/COVER">`;
            case 'boolean':
                return `<input type="checkbox" ${value ? 'checked' : ''} ${dataAttr}>`;
            case 'enum':
                let opts = (propDef.options || []).map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o || '(none)'}</option>`).join('');
                return `<select ${dataAttr}>${opts}</select>`;
            default:
                return `<input type="text" value="${escapeAttr(String(value ?? ''))}" ${dataAttr}>`;
        }
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
                let val;
                if (e.target.type === 'checkbox') {
                    val = e.target.checked;
                } else if (e.target.type === 'number') {
                    val = e.target.value === '' ? null : parseFloat(e.target.value);
                } else {
                    val = e.target.value || null;
                }
                updateWidgetStyle(state.selectedWidgetId, part, prop, val);
            };
            input.addEventListener('change', handler);
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
    }

    // ---- Widget Tree ----
    function renderWidgetTree() {
        if (!widgetTreeEl) return;
        const page = getCurrentPage();
        widgetTreeEl.innerHTML = '';
        renderTreeNodes(page.widgets, widgetTreeEl);
    }

    function renderTreeNodes(widgets, parentEl) {
        for (const widget of widgets) {
            const node = document.createElement('div');
            node.className = 'tree-node';

            const header = document.createElement('div');
            header.className = `tree-node-header ${widget.id === state.selectedWidgetId ? 'selected' : ''}`;

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

            header.addEventListener('click', () => {
                state.selectedWidgetId = widget.id;
                renderAll();
            });

            node.appendChild(header);

            if (widget.children && widget.children.length > 0) {
                const childrenEl = document.createElement('div');
                childrenEl.className = 'tree-node-children';
                renderTreeNodes(widget.children, childrenEl);
                node.appendChild(childrenEl);
            }

            parentEl.appendChild(node);
        }
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
        set selectedWidgetId(id) { state.selectedWidgetId = id; renderAll(); },
    };
})();
