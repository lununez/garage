/**
 * LVGL Preview Mode
 * Provides interactive preview of the designed UI.
 * Widgets respond to clicks, drags, and touch interactions.
 * Sliders can be dragged, switches toggled, buttons pressed, etc.
 * Event actions are logged to a console overlay.
 */

const PreviewMode = (() => {
    let active = false;
    let canvasEl = null;
    let eventLog = [];
    let eventLogEl = null;
    let previewState = {}; // Track interactive state changes during preview

    function init() {
        canvasEl = document.getElementById('canvas');
    }

    function isActive() {
        return active;
    }

    function enter() {
        active = true;
        canvasEl.classList.add('preview-mode');
        previewState = {};
        eventLog = [];

        // Create event log overlay
        eventLogEl = document.createElement('div');
        eventLogEl.className = 'preview-event-log';
        eventLogEl.innerHTML = '<div style="color:#6c8cff">-- Preview Mode --</div>';
        canvasEl.appendChild(eventLogEl);

        renderPreview();
    }

    function exit() {
        active = false;
        canvasEl.classList.remove('preview-mode');
        previewState = {};
        if (eventLogEl) {
            eventLogEl.remove();
            eventLogEl = null;
        }
        Designer.renderAll();
    }

    function logEvent(widgetId, eventName, detail) {
        const msg = `${widgetId}.${eventName}${detail ? ': ' + detail : ''}`;
        eventLog.push(msg);
        if (eventLog.length > 50) eventLog.shift();
        if (eventLogEl) {
            const div = document.createElement('div');
            div.textContent = msg;
            eventLogEl.appendChild(div);
            eventLogEl.scrollTop = eventLogEl.scrollHeight;
        }
    }

    function logAction(widgetId, eventName, action) {
        const actionDef = LVGLWidgets.ACTION_TYPES[action.type];
        let detail = actionDef?.label || action.type;
        if (action.fields) {
            const fieldStrs = Object.entries(action.fields)
                .filter(([k, v]) => v)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ');
            if (fieldStrs) detail += ` (${fieldStrs})`;
        }
        logEvent(widgetId, eventName, detail);
    }

    function fireEvent(widget, eventName) {
        if (widget.events && widget.events[eventName]) {
            for (const action of widget.events[eventName]) {
                logAction(widget.id, eventName, action);
            }
        } else {
            logEvent(widget.id, eventName, '');
        }
    }

    function getWidgetValue(widget) {
        if (previewState[widget.id]?.value !== undefined) {
            return previewState[widget.id].value;
        }
        return widget.properties.value ?? widget.properties.checked ?? 0;
    }

    function setWidgetValue(widget, value) {
        if (!previewState[widget.id]) previewState[widget.id] = {};
        previewState[widget.id].value = value;
    }

    function renderPreview() {
        if (!canvasEl || !active) return;
        // Save event log
        const savedLog = eventLogEl;

        canvasEl.innerHTML = '';
        const page = Designer.getCurrentPage();
        renderPreviewWidgets(page.widgets, canvasEl);

        // Re-add event log
        if (savedLog) {
            canvasEl.appendChild(savedLog);
            eventLogEl = savedLog;
        }
    }

    function renderPreviewWidgets(widgets, parentEl) {
        for (const widget of widgets) {
            const wrapperEl = document.createElement('div');
            wrapperEl.className = 'canvas-widget';
            wrapperEl.dataset.widgetId = widget.id;
            wrapperEl.style.left = widget.x + 'px';
            wrapperEl.style.top = widget.y + 'px';
            wrapperEl.style.width = widget.width + 'px';
            wrapperEl.style.height = widget.height + 'px';
            wrapperEl.style.cursor = 'default';

            // Create a modified widget copy with preview state
            const previewWidget = createPreviewWidget(widget);

            const visualEl = LVGLRenderer.render(previewWidget);
            wrapperEl.appendChild(visualEl);

            // Add interactive behavior based on widget type
            attachInteraction(widget, wrapperEl);

            // Render children
            if (widget.children && widget.children.length > 0) {
                renderPreviewWidgets(widget.children, wrapperEl);
            }

            parentEl.appendChild(wrapperEl);
        }
    }

    function createPreviewWidget(widget) {
        const pw = JSON.parse(JSON.stringify(widget));
        const ps = previewState[widget.id];
        if (ps) {
            if (ps.value !== undefined) {
                if (pw.type === 'switch' || pw.type === 'checkbox') {
                    pw.properties.checked = ps.value;
                } else {
                    pw.properties.value = ps.value;
                }
            }
        }
        return pw;
    }

    function attachInteraction(widget, wrapperEl) {
        const type = widget.type;

        // Common click events
        wrapperEl.addEventListener('mousedown', () => {
            fireEvent(widget, 'on_press');
        });
        wrapperEl.addEventListener('mouseup', () => {
            fireEvent(widget, 'on_release');
        });
        wrapperEl.addEventListener('click', () => {
            fireEvent(widget, 'on_click');
            fireEvent(widget, 'on_short_click');
        });

        // Long press detection
        let longPressTimer = null;
        wrapperEl.addEventListener('mousedown', () => {
            longPressTimer = setTimeout(() => {
                fireEvent(widget, 'on_long_press');
            }, 500);
        });
        wrapperEl.addEventListener('mouseup', () => {
            clearTimeout(longPressTimer);
        });
        wrapperEl.addEventListener('mouseleave', () => {
            clearTimeout(longPressTimer);
        });

        // Widget-specific interactions
        switch (type) {
            case 'slider':
                attachSliderInteraction(widget, wrapperEl);
                break;
            case 'arc':
                attachArcInteraction(widget, wrapperEl);
                break;
            case 'switch':
                attachSwitchInteraction(widget, wrapperEl);
                break;
            case 'checkbox':
                attachCheckboxInteraction(widget, wrapperEl);
                break;
            case 'button':
                attachButtonInteraction(widget, wrapperEl);
                break;
            case 'dropdown':
                attachDropdownInteraction(widget, wrapperEl);
                break;
            case 'roller':
                attachRollerInteraction(widget, wrapperEl);
                break;
            case 'spinbox':
                attachSpinboxInteraction(widget, wrapperEl);
                break;
        }
    }

    function attachSliderInteraction(widget, wrapperEl) {
        const vertical = widget.height > widget.width;
        let dragging = false;

        const updateSliderValue = (e) => {
            const rect = wrapperEl.getBoundingClientRect();
            const min = widget.properties.min_value ?? 0;
            const max = widget.properties.max_value ?? 100;
            let pct;
            if (vertical) {
                pct = 1 - (e.clientY - rect.top) / rect.height;
            } else {
                pct = (e.clientX - rect.left) / rect.width;
            }
            pct = Math.max(0, Math.min(1, pct));
            const val = Math.round(min + pct * (max - min));
            setWidgetValue(widget, val);
            fireEvent(widget, 'on_value_change');
            renderPreview();
        };

        wrapperEl.style.cursor = 'pointer';
        wrapperEl.addEventListener('mousedown', (e) => {
            dragging = true;
            updateSliderValue(e);
            e.stopPropagation();
        });

        document.addEventListener('mousemove', (e) => {
            if (dragging) updateSliderValue(e);
        });

        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                fireEvent(widget, 'on_release');
            }
        });

        // Show value tooltip
        const valueDisplay = document.createElement('div');
        valueDisplay.className = 'preview-value-display';
        const val = getWidgetValue(widget);
        valueDisplay.textContent = val;
        if (vertical) {
            valueDisplay.style.top = '-18px';
            valueDisplay.style.left = '50%';
            valueDisplay.style.transform = 'translateX(-50%)';
        } else {
            valueDisplay.style.top = '-18px';
            valueDisplay.style.left = '50%';
            valueDisplay.style.transform = 'translateX(-50%)';
        }
        wrapperEl.appendChild(valueDisplay);
    }

    function attachArcInteraction(widget, wrapperEl) {
        wrapperEl.style.cursor = 'pointer';
        const updateArcValue = (e) => {
            const rect = wrapperEl.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI + 90;
            const normalizedAngle = ((angle % 360) + 360) % 360;

            const startAngle = widget.properties.start_angle ?? 135;
            const endAngle = widget.properties.end_angle ?? 45;
            let totalSpan = endAngle - startAngle;
            if (totalSpan <= 0) totalSpan += 360;

            let relAngle = normalizedAngle - startAngle;
            if (relAngle < 0) relAngle += 360;
            const pct = Math.max(0, Math.min(1, relAngle / totalSpan));

            const min = widget.properties.min_value ?? 0;
            const max = widget.properties.max_value ?? 100;
            const val = Math.round(min + pct * (max - min));
            setWidgetValue(widget, val);
            fireEvent(widget, 'on_value_change');
            renderPreview();
        };

        let dragging = false;
        wrapperEl.addEventListener('mousedown', (e) => {
            dragging = true;
            updateArcValue(e);
            e.stopPropagation();
        });
        document.addEventListener('mousemove', (e) => {
            if (dragging) updateArcValue(e);
        });
        document.addEventListener('mouseup', () => { dragging = false; });
    }

    function attachSwitchInteraction(widget, wrapperEl) {
        wrapperEl.style.cursor = 'pointer';
        wrapperEl.addEventListener('click', (e) => {
            const current = getWidgetValue(widget);
            const newVal = !current;
            setWidgetValue(widget, newVal);
            fireEvent(widget, 'on_value_change');
            renderPreview();
            e.stopPropagation();
        });
    }

    function attachCheckboxInteraction(widget, wrapperEl) {
        wrapperEl.style.cursor = 'pointer';
        wrapperEl.addEventListener('click', (e) => {
            const current = getWidgetValue(widget);
            const newVal = !current;
            setWidgetValue(widget, newVal);
            fireEvent(widget, 'on_value_change');
            renderPreview();
            e.stopPropagation();
        });
    }

    function attachButtonInteraction(widget, wrapperEl) {
        wrapperEl.style.cursor = 'pointer';
        wrapperEl.addEventListener('mousedown', () => {
            wrapperEl.querySelector('.lvgl-button')?.style.setProperty('filter', 'brightness(0.8)');
        });
        wrapperEl.addEventListener('mouseup', () => {
            wrapperEl.querySelector('.lvgl-button')?.style.removeProperty('filter');
        });
        wrapperEl.addEventListener('mouseleave', () => {
            wrapperEl.querySelector('.lvgl-button')?.style.removeProperty('filter');
        });
    }

    function attachDropdownInteraction(widget, wrapperEl) {
        wrapperEl.style.cursor = 'pointer';
        wrapperEl.addEventListener('click', (e) => {
            const opts = (widget.properties.options || '').split('\n').filter(s => s.trim());
            const current = previewState[widget.id]?.selectedIndex ?? widget.properties.selected_index ?? 0;
            const next = (current + 1) % opts.length;
            if (!previewState[widget.id]) previewState[widget.id] = {};
            previewState[widget.id].selectedIndex = next;
            // Update the displayed option
            setWidgetValue(widget, next);
            fireEvent(widget, 'on_value_change');
            logEvent(widget.id, 'selection', opts[next]);
            renderPreview();
            e.stopPropagation();
        });
    }

    function attachRollerInteraction(widget, wrapperEl) {
        wrapperEl.style.cursor = 'ns-resize';
        wrapperEl.addEventListener('wheel', (e) => {
            e.preventDefault();
            const opts = (widget.properties.options || '').split('\n').filter(s => s.trim());
            const current = previewState[widget.id]?.selectedIndex ?? widget.properties.selected_index ?? 2;
            const next = e.deltaY > 0
                ? Math.min(opts.length - 1, current + 1)
                : Math.max(0, current - 1);
            if (!previewState[widget.id]) previewState[widget.id] = {};
            previewState[widget.id].selectedIndex = next;
            setWidgetValue(widget, next);
            fireEvent(widget, 'on_value_change');
            renderPreview();
        });
    }

    function attachSpinboxInteraction(widget, wrapperEl) {
        const btns = wrapperEl.querySelectorAll('.lvgl-spinbox-btn');
        if (btns.length >= 2) {
            btns[0].style.cursor = 'pointer';
            btns[0].addEventListener('click', (e) => {
                e.stopPropagation();
                const step = widget.properties.step || 1;
                const min = widget.properties.min_value ?? -99;
                const val = Math.max(min, (getWidgetValue(widget) || 0) - step);
                setWidgetValue(widget, val);
                fireEvent(widget, 'on_value_change');
                renderPreview();
            });
            btns[1].style.cursor = 'pointer';
            btns[1].addEventListener('click', (e) => {
                e.stopPropagation();
                const step = widget.properties.step || 1;
                const max = widget.properties.max_value ?? 99;
                const val = Math.min(max, (getWidgetValue(widget) || 0) + step);
                setWidgetValue(widget, val);
                fireEvent(widget, 'on_value_change');
                renderPreview();
            });
        }
    }

    return {
        init,
        isActive,
        enter,
        exit,
        renderPreview,
        logEvent,
    };
})();
