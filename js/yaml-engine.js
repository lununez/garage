/**
 * YAML Engine for ESPHome LVGL
 * Handles YAML generation from designer state, parsing YAML back to state,
 * validation against ESPHome LVGL schema, and CodeMirror editor integration.
 */

const YAMLEngine = (() => {

    let codeMirrorEditor = null;
    let isUpdatingFromDesigner = false;
    let isUpdatingFromEditor = false;
    let onApply = null;
    let validationTimer = null;

    // ---- Custom YAML Schema for ESPHome tags ----
    // ESPHome uses custom YAML tags like !lambda, !secret, !include, etc.
    // We define them so js-yaml can parse without errors, preserving the values.

    const ESPHOME_TAGS = ['lambda', 'secret', 'include', 'extend', 'remove'];
    const customTypes = ESPHOME_TAGS.map(tag =>
        new jsyaml.Type('!' + tag, {
            kind: 'scalar',
            construct: (data) => `!${tag} ${data}`,
            represent: (data) => data,
        })
    );
    // Also handle !lambda with mapping kind (for multi-line lambdas)
    customTypes.push(new jsyaml.Type('!lambda', {
        kind: 'mapping',
        construct: (data) => ({ __lambda: true, ...data }),
    }));

    const ESPHOME_SCHEMA = jsyaml.DEFAULT_SCHEMA.extend(customTypes);

    function yamlLoad(str) {
        return jsyaml.load(str, { schema: ESPHOME_SCHEMA });
    }

    function yamlDump(obj, opts) {
        return jsyaml.dump(obj, { schema: ESPHOME_SCHEMA, ...opts });
    }

    // ---- Initialization ----
    function init(options = {}) {
        onApply = options.onApply || null;
        initCodeMirror();
    }

    function initCodeMirror() {
        const textarea = document.getElementById('yaml-editor');
        if (!textarea) return;

        codeMirrorEditor = CodeMirror.fromTextArea(textarea, {
            mode: 'yaml',
            theme: 'monokai',
            lineNumbers: true,
            tabSize: 2,
            indentWithTabs: false,
            lineWrapping: true,
            matchBrackets: true,
            foldGutter: true,
            gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
            extraKeys: {
                Tab: (cm) => cm.replaceSelection('  ', 'end'),
            },
        });

        // Live validation on change
        codeMirrorEditor.on('change', () => {
            if (isUpdatingFromDesigner) return;
            clearTimeout(validationTimer);
            validationTimer = setTimeout(() => {
                validateEditorContent();
            }, 500);
        });
    }

    // ---- YAML Generation ----

    /**
     * Generate ESPHome LVGL YAML from designer state.
     */
    function generateYAML(designerState) {
        const doc = {
            lvgl: {
                pages: [],
            },
        };

        for (const page of designerState.pages) {
            const pageObj = {
                id: page.id,
                widgets: [],
            };

            for (const widget of page.widgets) {
                pageObj.widgets.push(widgetToYAML(widget));
            }

            doc.lvgl.pages.push(pageObj);
        }

        return yamlDump(doc, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: false,
            quotingType: '"',
            forceQuotes: false,
        });
    }

    /**
     * Convert a widget instance to a YAML-compatible object.
     */
    function widgetToYAML(widget) {
        const obj = {};
        const inner = {};

        // ID
        inner.id = widget.id;

        // Position
        if (widget.x !== 0) inner.x = widget.x;
        if (widget.y !== 0) inner.y = widget.y;

        // Size
        inner.width = widget.width;
        inner.height = widget.height;

        // Widget-specific properties
        const def = LVGLWidgets.getWidgetDef(widget.type);
        if (def) {
            for (const [key, propDef] of Object.entries(def.properties)) {
                // Skip designer-only properties (not valid in ESPHome YAML)
                if (propDef.yamlExclude) continue;

                const val = widget.properties[key];
                if (val !== null && val !== undefined && val !== '' && val !== propDef.default) {
                    // Property mapping (e.g. adjustable:false -> disabled:true)
                    if (propDef.yamlMap) {
                        const mappedVal = propDef.yamlInvert ? !val : val;
                        // Only emit if the mapped value is truthy (e.g. disabled: true)
                        if (mappedVal) {
                            inner[propDef.yamlMap] = mappedVal;
                        }
                        continue;
                    }
                    // Handle multi-line text properties
                    if (propDef.type === 'text' && typeof val === 'string' && val.includes('\n')) {
                        inner[key] = val;
                    } else {
                        inner[key] = val;
                    }
                }
            }
        }

        // Styles for each part
        if (widget.styles) {
            for (const [part, styles] of Object.entries(widget.styles)) {
                const cleanStyles = {};
                let hasStyles = false;
                for (const [prop, val] of Object.entries(styles)) {
                    if (val !== null && val !== undefined && val !== '') {
                        cleanStyles[prop] = formatStyleValue(prop, val);
                        hasStyles = true;
                    }
                }
                if (hasStyles) {
                    inner[part] = cleanStyles;
                }
            }
        }

        // Events/Actions
        if (widget.events) {
            for (const [eventName, actions] of Object.entries(widget.events)) {
                if (actions && actions.length > 0) {
                    inner[eventName] = actions.map(a => actionToYAML(a));
                }
            }
        }

        // Children
        if (widget.children && widget.children.length > 0) {
            inner.widgets = widget.children.map(c => widgetToYAML(c));
        }

        obj[widget.type] = inner;
        return obj;
    }

    /**
     * Convert an action instance to YAML-compatible object.
     */
    function actionToYAML(action) {
        if (action.type === 'lambda') {
            return { lambda: action.fields?.code || '' };
        }

        const obj = {};
        const actionObj = {};

        for (const [key, val] of Object.entries(action.fields || {})) {
            if (val !== null && val !== undefined && val !== '') {
                // Check if value contains !lambda
                if (typeof val === 'string' && val.includes('!lambda')) {
                    actionObj[key] = val;
                } else if (key === 'data' && typeof val === 'string') {
                    // Parse data as YAML map
                    try {
                        actionObj[key] = yamlLoad(val) || {};
                    } catch (e) {
                        actionObj[key] = val;
                    }
                } else {
                    actionObj[key] = val;
                }
            }
        }

        obj[action.type] = actionObj;
        return obj;
    }

    /**
     * Format a style value for YAML output.
     */
    function formatStyleValue(prop, val) {
        // Color values: convert #RRGGBB to 0xRRGGBB for ESPHome
        if (prop.includes('color') && typeof val === 'string' && val.startsWith('#')) {
            return '0x' + val.slice(1).toUpperCase();
        }
        return val;
    }

    // ---- YAML Parsing ----

    /**
     * Parse ESPHome LVGL YAML into designer state.
     */
    function parseYAML(yamlStr) {
        const doc = yamlLoad(yamlStr);
        if (!doc) throw new Error('Empty YAML document');

        const result = {
            pages: [],
        };

        // Handle different YAML structures
        let lvglConfig = doc;
        if (doc.lvgl) lvglConfig = doc.lvgl;

        if (lvglConfig.pages) {
            for (const pageYaml of lvglConfig.pages) {
                const page = {
                    id: pageYaml.id || 'page_' + (result.pages.length + 1),
                    name: pageYaml.id || 'Page ' + (result.pages.length + 1),
                    widgets: [],
                };

                if (pageYaml.widgets) {
                    for (const widgetYaml of pageYaml.widgets) {
                        const widget = parseWidgetYAML(widgetYaml);
                        if (widget) page.widgets.push(widget);
                    }
                }

                result.pages.push(page);
            }
        }

        // If no pages found, try parsing as flat widget list
        if (result.pages.length === 0) {
            const page = { id: 'main_page', name: 'Main', widgets: [] };
            if (lvglConfig.widgets) {
                for (const widgetYaml of lvglConfig.widgets) {
                    const widget = parseWidgetYAML(widgetYaml);
                    if (widget) page.widgets.push(widget);
                }
            }
            result.pages.push(page);
        }

        return result;
    }

    /**
     * Parse a single widget from YAML format.
     */
    function parseWidgetYAML(widgetYaml) {
        // Widget YAML is { type: { properties... } }
        const type = Object.keys(widgetYaml)[0];
        const props = widgetYaml[type];

        if (!type || !props) return null;

        const def = LVGLWidgets.getWidgetDef(type);
        if (!def) {
            console.warn(`Unknown widget type: ${type}`);
            return null;
        }

        const widget = {
            id: props.id || type + '_' + Math.floor(Math.random() * 1000),
            type,
            x: props.x || 0,
            y: props.y || 0,
            width: props.width || def.defaultSize.width,
            height: props.height || def.defaultSize.height,
            properties: {},
            styles: {},
            children: [],
        };

        // Parse widget-specific properties
        for (const [key, propDef] of Object.entries(def.properties)) {
            // Reverse-map YAML keys (e.g. disabled -> adjustable)
            if (propDef.yamlMap && props[propDef.yamlMap] !== undefined) {
                const val = props[propDef.yamlMap];
                widget.properties[key] = propDef.yamlInvert ? !val : val;
            } else if (props[key] !== undefined) {
                widget.properties[key] = props[key];
            } else if (propDef.default !== null && propDef.default !== undefined) {
                widget.properties[key] = propDef.default;
            }
        }

        // Parse styles for each part
        for (const part of (def.parts || ['main'])) {
            if (props[part] && typeof props[part] === 'object') {
                widget.styles[part] = {};
                for (const [prop, val] of Object.entries(props[part])) {
                    widget.styles[part][prop] = parseStyleValue(prop, val);
                }
            } else {
                widget.styles[part] = {};
            }
        }

        // Parse events/actions
        widget.events = {};
        const eventNames = Object.keys(LVGLWidgets.EVENTS);
        for (const eventName of eventNames) {
            if (props[eventName]) {
                const rawActions = Array.isArray(props[eventName]) ? props[eventName] : [props[eventName]];
                widget.events[eventName] = rawActions.map(a => parseActionYAML(a)).filter(Boolean);
            }
        }

        // Parse children
        if (props.widgets && Array.isArray(props.widgets)) {
            for (const childYaml of props.widgets) {
                const child = parseWidgetYAML(childYaml);
                if (child) widget.children.push(child);
            }
        }

        return widget;
    }

    /**
     * Parse a single action from YAML format.
     */
    function parseActionYAML(actionYaml) {
        if (!actionYaml || typeof actionYaml !== 'object') return null;

        // Handle lambda shorthand
        if (actionYaml.lambda !== undefined) {
            return { type: 'lambda', fields: { code: actionYaml.lambda } };
        }

        const type = Object.keys(actionYaml)[0];
        const fields = actionYaml[type] || {};

        const result = { type, fields: {} };
        for (const [key, val] of Object.entries(fields)) {
            if (key === 'data' && typeof val === 'object') {
                result.fields[key] = yamlDump(val, { indent: 2 }).trim();
            } else {
                result.fields[key] = val;
            }
        }
        return result;
    }

    /**
     * Parse a style value from YAML format.
     */
    function parseStyleValue(prop, val) {
        // Convert 0xRRGGBB to #RRGGBB
        if (prop.includes('color') && typeof val === 'string' && val.match(/^0x[0-9A-Fa-f]{6}$/)) {
            return '#' + val.slice(2).toLowerCase();
        }
        // Handle numeric 0xRRGGBB
        if (prop.includes('color') && typeof val === 'number') {
            return '#' + val.toString(16).padStart(6, '0');
        }
        return val;
    }

    // ---- Validation ----

    /**
     * Validate ESPHome LVGL YAML structure and semantics.
     * Returns an array of validation messages.
     */
    function validate(yamlStr) {
        const results = [];

        // 1. Parse check
        let doc;
        try {
            doc = yamlLoad(yamlStr);
        } catch (e) {
            results.push({
                type: 'error',
                message: `YAML Syntax Error: ${e.message}`,
                line: e.mark ? e.mark.line + 1 : null,
            });
            return results;
        }

        if (!doc) {
            results.push({ type: 'error', message: 'Empty YAML document' });
            return results;
        }

        // 2. Structure validation
        let lvglConfig = doc;
        if (doc.lvgl) {
            lvglConfig = doc.lvgl;
        } else {
            results.push({ type: 'warning', message: 'Missing top-level "lvgl:" key. ESPHome expects this.' });
        }

        // 3. Pages validation
        if (lvglConfig.pages) {
            if (!Array.isArray(lvglConfig.pages)) {
                results.push({ type: 'error', message: '"pages" must be a list' });
            } else {
                const pageIds = new Set();
                for (let i = 0; i < lvglConfig.pages.length; i++) {
                    const page = lvglConfig.pages[i];
                    if (page.id) {
                        if (pageIds.has(page.id)) {
                            results.push({ type: 'error', message: `Duplicate page ID: "${page.id}"` });
                        }
                        pageIds.add(page.id);

                        if (!isValidId(page.id)) {
                            results.push({ type: 'error', message: `Invalid page ID "${page.id}": must be a valid C identifier (letters, digits, underscores)` });
                        }
                    }

                    if (page.widgets) {
                        validateWidgets(page.widgets, results, `pages[${i}]`);
                    }
                }
            }
        }

        // 4. Direct widgets validation
        if (lvglConfig.widgets) {
            validateWidgets(lvglConfig.widgets, results, 'root');
        }

        if (results.length === 0) {
            results.push({ type: 'success', message: 'YAML is valid ESPHome LVGL configuration.' });
        }

        return results;
    }

    /**
     * Validate a list of widget YAML objects.
     */
    function validateWidgets(widgets, results, path) {
        if (!Array.isArray(widgets)) {
            results.push({ type: 'error', message: `${path}.widgets must be a list` });
            return;
        }

        const widgetIds = new Set();
        for (let i = 0; i < widgets.length; i++) {
            const widgetYaml = widgets[i];
            const type = Object.keys(widgetYaml)[0];
            const props = widgetYaml[type];
            const wPath = `${path}.widgets[${i}]`;

            // Type check
            const def = LVGLWidgets.getWidgetDef(type);
            if (!def) {
                results.push({ type: 'warning', message: `${wPath}: Unknown widget type "${type}"` });
                continue;
            }

            if (!props || typeof props !== 'object') {
                results.push({ type: 'error', message: `${wPath}: Widget "${type}" must have properties object` });
                continue;
            }

            // ID check
            if (props.id) {
                if (widgetIds.has(props.id)) {
                    results.push({ type: 'error', message: `${wPath}: Duplicate widget ID "${props.id}"` });
                }
                widgetIds.add(props.id);

                if (!isValidId(props.id)) {
                    results.push({ type: 'error', message: `${wPath}: Invalid ID "${props.id}": must be a valid C identifier` });
                }
            }

            // Size check
            if (props.width !== undefined && typeof props.width === 'number' && props.width <= 0) {
                results.push({ type: 'warning', message: `${wPath}: Width should be positive` });
            }
            if (props.height !== undefined && typeof props.height === 'number' && props.height <= 0) {
                results.push({ type: 'warning', message: `${wPath}: Height should be positive` });
            }

            // Slider-specific validation
            if (type === 'slider') {
                const min = props.min_value ?? 0;
                const max = props.max_value ?? 100;
                const val = props.value;
                if (min >= max) {
                    results.push({ type: 'error', message: `${wPath}: Slider min_value (${min}) must be less than max_value (${max})` });
                }
                if (val !== undefined && (val < min || val > max)) {
                    results.push({ type: 'warning', message: `${wPath}: Slider value (${val}) is outside range [${min}, ${max}]` });
                }
            }

            // Arc-specific validation
            if (type === 'arc') {
                if (props.arc_width !== undefined && props.arc_width <= 0) {
                    results.push({ type: 'warning', message: `${wPath}: Arc width should be positive` });
                }
            }

            // Property type validation
            for (const [key, propDef] of Object.entries(def.properties)) {
                if (props[key] !== undefined) {
                    const val = props[key];
                    if (propDef.type === 'number' && typeof val !== 'number') {
                        results.push({ type: 'warning', message: `${wPath}: "${key}" should be a number, got ${typeof val}` });
                    }
                    if (propDef.type === 'boolean' && typeof val !== 'boolean') {
                        results.push({ type: 'warning', message: `${wPath}: "${key}" should be boolean, got ${typeof val}` });
                    }
                    if (propDef.type === 'enum' && propDef.options && !propDef.options.includes(val)) {
                        results.push({ type: 'warning', message: `${wPath}: "${key}" value "${val}" is not a valid option` });
                    }
                }
            }

            // Style validation
            for (const part of (def.parts || [])) {
                if (props[part] && typeof props[part] === 'object') {
                    for (const [styleProp, styleVal] of Object.entries(props[part])) {
                        if (!LVGLWidgets.STYLE_PROPS[styleProp]) {
                            results.push({ type: 'info', message: `${wPath}.${part}: Unknown style property "${styleProp}"` });
                        }
                    }
                }
            }

            // Children with non-container check
            if (props.widgets && !def.canContain) {
                results.push({ type: 'warning', message: `${wPath}: Widget type "${type}" does not support child widgets` });
            }

            // Recursive children validation
            if (props.widgets) {
                validateWidgets(props.widgets, results, wPath);
            }
        }
    }

    function isValidId(id) {
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id);
    }

    // ---- Editor Integration ----

    /**
     * Update the CodeMirror editor content from designer state.
     */
    function updateEditorFromState(designerState) {
        if (!codeMirrorEditor || isUpdatingFromEditor) return;
        isUpdatingFromDesigner = true;
        const yaml = generateYAML(designerState);
        codeMirrorEditor.setValue(yaml);
        isUpdatingFromDesigner = false;
        updateValidationStatus(validate(yaml));
    }

    /**
     * Get current editor content as YAML string.
     */
    function getEditorContent() {
        return codeMirrorEditor ? codeMirrorEditor.getValue() : '';
    }

    /**
     * Apply YAML from editor to designer.
     */
    function applyEditorToDesigner() {
        const yaml = getEditorContent();
        const validationResults = validate(yaml);
        const hasErrors = validationResults.some(r => r.type === 'error');

        if (hasErrors) {
            updateValidationStatus(validationResults);
            return { success: false, results: validationResults };
        }

        try {
            isUpdatingFromEditor = true;
            const newState = parseYAML(yaml);
            if (onApply) {
                onApply(newState);
            }
            isUpdatingFromEditor = false;
            updateValidationStatus(validationResults);
            return { success: true, results: validationResults };
        } catch (e) {
            isUpdatingFromEditor = false;
            return {
                success: false,
                results: [{ type: 'error', message: `Parse error: ${e.message}` }],
            };
        }
    }

    /**
     * Validate the current editor content and update status indicators.
     */
    function validateEditorContent() {
        const yaml = getEditorContent();
        const results = validate(yaml);
        updateValidationStatus(results);
        return results;
    }

    function updateValidationStatus(results) {
        const iconEl = document.getElementById('yaml-status-icon');
        const textEl = document.getElementById('yaml-status-text');
        if (!iconEl || !textEl) return;

        const errors = results.filter(r => r.type === 'error');
        const warnings = results.filter(r => r.type === 'warning');

        if (errors.length > 0) {
            iconEl.textContent = '\u2717';
            iconEl.className = 'status-error';
            textEl.textContent = `${errors.length} error(s)`;
        } else if (warnings.length > 0) {
            iconEl.textContent = '!';
            iconEl.className = 'status-warn';
            textEl.textContent = `${warnings.length} warning(s)`;
        } else {
            iconEl.textContent = '\u2713';
            iconEl.className = 'status-ok';
            textEl.textContent = 'Valid';
        }
    }

    /**
     * Format/prettify the current editor content.
     */
    function formatEditor() {
        if (!codeMirrorEditor) return;
        try {
            const yaml = codeMirrorEditor.getValue();
            const doc = yamlLoad(yaml);
            const formatted = yamlDump(doc, {
                indent: 2,
                lineWidth: 120,
                noRefs: true,
                sortKeys: false,
            });
            isUpdatingFromDesigner = true;
            codeMirrorEditor.setValue(formatted);
            isUpdatingFromDesigner = false;
        } catch (e) {
            // If YAML is invalid, don't format
        }
    }

    /**
     * Export YAML as downloadable file.
     */
    function exportYAML(designerState) {
        const yaml = generateYAML(designerState);
        const blob = new Blob([yaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lvgl_ui.yaml';
        a.click();
        URL.revokeObjectURL(url);
    }

    // ---- Public API ----
    return {
        init,
        generateYAML,
        parseYAML,
        validate,
        updateEditorFromState,
        getEditorContent,
        applyEditorToDesigner,
        validateEditorContent,
        formatEditor,
        exportYAML,
    };
})();
