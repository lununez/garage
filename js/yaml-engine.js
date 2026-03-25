/**
 * YAML Engine for ESPHome LVGL
 * Handles YAML generation from designer state, parsing YAML back to state,
 * validation against ESPHome LVGL schema, and CodeMirror editor integration.
 *
 * Key fixes over original:
 * - !lambda tags properly preserved via post-processing
 * - Color values (0xRRGGBB) properly quoted
 * - Data fields with lambdas properly structured
 * - Full device YAML generation with sensor/binary_sensor blocks from entity bindings
 */

const YAMLEngine = (() => {

    let codeMirrorEditor = null;
    let isUpdatingFromDesigner = false;
    let isUpdatingFromEditor = false;
    let onApply = null;
    let validationTimer = null;

    // ---- Custom YAML Schema for ESPHome tags ----
    // Lambda placeholder: during generation we use __LAMBDA__code as a sentinel.
    // After js-yaml dump, we post-process to convert these to proper !lambda "code" tags.
    const LAMBDA_SENTINEL = '__LAMBDA__';

    const ESPHOME_TAGS = ['lambda', 'secret', 'include', 'extend', 'remove'];
    const customTypes = ESPHOME_TAGS.map(tag =>
        new jsyaml.Type('!' + tag, {
            kind: 'scalar',
            construct: (data) => {
                if (tag === 'lambda') {
                    // Preserve as sentinel so we can reconstruct the tag on dump
                    return LAMBDA_SENTINEL + data;
                }
                return `!${tag} ${data}`;
            },
            represent: (data) => data,
        })
    );
    // Handle !lambda with mapping kind (multi-line lambdas)
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

    // ---- Post-processing for ESPHome YAML ----

    /**
     * Post-process YAML output to fix ESPHome-specific syntax:
     * 1. Convert __LAMBDA__ sentinels to !lambda "code" tags
     * 2. Ensure 0xRRGGBB color values are quoted strings
     * 3. Fix any !secret/!include tag representations
     */
    function postProcessYaml(yamlStr) {
        let result = yamlStr;

        // Fix lambda sentinels: convert "__LAMBDA__code" → !lambda "code"
        // Handle both quoted and unquoted forms from js-yaml dump
        result = result.replace(/"__LAMBDA__((?:[^"\\]|\\.)*)"/g, (match, code) => {
            return '!lambda "' + code + '"';
        });
        result = result.replace(/'__LAMBDA__([^']*)'/g, (match, code) => {
            return '!lambda "' + code + '"';
        });
        result = result.replace(/:\s+__LAMBDA__(.+)$/gm, (match, code) => {
            return ': !lambda "' + code.trim() + '"';
        });

        // Fix !secret and !include tag representations
        // js-yaml construct stores these as "!secret value" strings
        for (const tag of ['secret', 'include', 'extend', 'remove']) {
            const pattern = new RegExp(`["']!${tag}\\s+([^"']+)["']`, 'g');
            result = result.replace(pattern, `!${tag} $1`);
            // Also handle unquoted form
            const unquotedPattern = new RegExp(`:\\s+!${tag}\\s+(.+)$`, 'gm');
            // These are already correct, no change needed
        }

        // Ensure 0xRRGGBB color values are always quoted strings, not bare hex literals
        // js-yaml may dump them unquoted which YAML parsers interpret as integers
        result = result.replace(/:\s+(0x[0-9A-Fa-f]{6})\s*$/gm, (match, hex) => {
            return ': "' + hex + '"';
        });

        // Ensure percentage values (like opacity "100%") are quoted
        result = result.replace(/:\s+(\d+%)\s*$/gm, (match, pct) => {
            return ': "' + pct + '"';
        });

        return result;
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
     * This produces the lvgl: and font: sections only.
     */
    function generateYAML(designerState) {
        const doc = {};

        // Font declarations
        if (typeof FontManager !== 'undefined') {
            const fontYaml = FontManager.toYAML();
            if (fontYaml && fontYaml.length > 0) {
                doc.font = fontYaml;
            }
        }

        doc.lvgl = { pages: [] };

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

        const rawYaml = yamlDump(doc, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: false,
            quotingType: '"',
            forceQuotes: false,
        });

        return postProcessYaml(rawYaml);
    }

    /**
     * Generate full device-ready YAML including sensor blocks from entity bindings.
     * This is used for deployment — produces lvgl + font + sensor + binary_sensor sections.
     */
    function generateFullYAML(designerState) {
        let yaml = generateYAML(designerState);

        // Generate sensor blocks from entity bindings
        if (typeof EntityBinding !== 'undefined') {
            const sensorBlocks = EntityBinding.generateSensorBlocks(designerState);

            if (sensorBlocks.sensor && sensorBlocks.sensor.length > 0) {
                yaml += '\n' + generateSensorSectionYaml('sensor', sensorBlocks.sensor);
            }
            if (sensorBlocks.binary_sensor && sensorBlocks.binary_sensor.length > 0) {
                yaml += '\n' + generateSensorSectionYaml('binary_sensor', sensorBlocks.binary_sensor);
            }
        }

        return yaml;
    }

    /**
     * Generate YAML text for a sensor/binary_sensor section.
     */
    function generateSensorSectionYaml(sectionKey, entries) {
        let yaml = sectionKey + ':\n';
        for (const entry of entries) {
            yaml += '  - platform: homeassistant\n';
            if (entry.id) yaml += '    id: ' + entry.id + '\n';
            if (entry.entity_id) yaml += '    entity_id: ' + entry.entity_id + '\n';
            if (entry.attribute) yaml += '    attribute: ' + entry.attribute + '\n';

            const handler = entry.on_value || entry.on_state;
            const handlerKey = entry.on_value ? 'on_value' : 'on_state';
            if (handler) {
                yaml += '    ' + handlerKey + ':\n';
                for (const action of handler) {
                    const actionKey = Object.keys(action)[0];
                    const actionData = action[actionKey];
                    yaml += '      - ' + actionKey + ':\n';
                    for (const [key, val] of Object.entries(actionData)) {
                        if (typeof val === 'string' && val.startsWith(LAMBDA_SENTINEL)) {
                            yaml += '          ' + key + ': !lambda "' + val.slice(LAMBDA_SENTINEL.length) + '"\n';
                        } else {
                            yaml += '          ' + key + ': ' + val + '\n';
                        }
                    }
                }
            }
        }
        return yaml;
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
                if (propDef.isStyle) {
                    const val = widget.properties[key];
                    if (val !== null && val !== undefined && val !== '' && val !== propDef.default) {
                        const part = propDef.stylePart || 'main';
                        if (!inner[part]) inner[part] = {};
                        inner[part][key] = formatStyleValue(key, val);
                    }
                    continue;
                }
                if (propDef.yamlExclude) continue;
                if (propDef.childLabel) continue;

                const val = widget.properties[key];
                if (val !== null && val !== undefined && val !== '' && val !== propDef.default) {
                    if (propDef.yamlMap) {
                        const mappedVal = propDef.yamlInvert ? !val : val;
                        if (mappedVal) {
                            inner[propDef.yamlMap] = mappedVal;
                        }
                        continue;
                    }
                    inner[key] = val;
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
                    if (!inner[part]) {
                        inner[part] = cleanStyles;
                    } else {
                        Object.assign(inner[part], cleanStyles);
                    }
                }
            }
        }

        // Translate designer-only knob_style into ESPHome knob part styles
        if ((widget.type === 'slider' || widget.type === 'arc') && widget.properties) {
            const knobStyle = widget.properties.knob_style || 'circle';
            const vertical = widget.height > widget.width;
            const knobPart = inner.knob || {};

            if (knobStyle === 'bar') {
                knobPart.radius = 2;
                knobPart.bg_color = knobPart.bg_color || '0xFFFFFF';
                if (widget.properties.knob_width) {
                    knobPart.width = widget.properties.knob_width;
                } else {
                    knobPart.width = vertical ? widget.width + 6 : 4;
                }
                if (widget.properties.knob_height) {
                    knobPart.height = widget.properties.knob_height;
                } else {
                    knobPart.height = vertical ? 4 : widget.height + 6;
                }
                inner.knob = knobPart;
            } else if (knobStyle === 'none') {
                knobPart.bg_opa = 'TRANSP';
                knobPart.border_width = 0;
                knobPart.shadow_width = 0;
                knobPart.width = 0;
                knobPart.height = 0;
                inner.knob = knobPart;
            } else if (knobStyle === 'circle') {
                const kSize = widget.properties.knob_width;
                if (kSize) {
                    knobPart.radius = '50%';
                    knobPart.width = kSize;
                    knobPart.height = kSize;
                    inner.knob = knobPart;
                }
            }
        }

        // Events/Actions
        if (widget.events) {
            for (const [eventName, actions] of Object.entries(widget.events)) {
                if (actions && actions.length > 0) {
                    // Check for conditional binding actions (switch on/off)
                    const hasConditional = actions.some(a => a._binding_conditional);
                    if (hasConditional && widget.binding) {
                        const conditionalActions = EntityBinding.generateConditionalActions(widget);
                        if (conditionalActions) {
                            inner[eventName] = conditionalActions;
                            continue;
                        }
                    }
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
                if (key === 'data' && typeof val === 'string') {
                    // Parse data as YAML map, handling !lambda within data values
                    try {
                        const parsed = yamlLoad(val);
                        if (parsed && typeof parsed === 'object') {
                            // Convert any lambda sentinels back to the right form
                            const processedData = {};
                            for (const [dk, dv] of Object.entries(parsed)) {
                                if (typeof dv === 'string' && dv.startsWith(LAMBDA_SENTINEL)) {
                                    // Keep as sentinel — postProcessYaml will convert to !lambda tag
                                    processedData[dk] = dv;
                                } else {
                                    processedData[dk] = dv;
                                }
                            }
                            actionObj[key] = processedData;
                        } else {
                            actionObj[key] = val;
                        }
                    } catch (e) {
                        // If parsing fails, output as-is (user may have typed raw YAML)
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
        // Opacity values: convert 0-255 integers to percentage strings for ESPHome
        if (prop === 'opa' || prop.endsWith('_opa')) {
            return formatOpacityValue(val);
        }
        return val;
    }

    /**
     * Format opacity value for ESPHome YAML.
     * ESPHome expects percentage strings ("100%", "50%") or named constants (TRANSP, COVER).
     * The designer may store values as 0-255 integers.
     */
    function formatOpacityValue(val) {
        if (val === null || val === undefined || val === '') return val;
        const strVal = String(val).trim();
        // Named constants pass through as-is
        if (strVal.toUpperCase() === 'TRANSP' || strVal.toUpperCase() === 'COVER') {
            return strVal.toUpperCase();
        }
        // Already a percentage string — pass through
        if (strVal.endsWith('%')) {
            return strVal;
        }
        // Numeric value: convert 0-255 range to 0-100% for ESPHome
        const num = parseFloat(strVal);
        if (!isNaN(num)) {
            if (num > 1 && num <= 255) {
                // 0-255 range → percentage
                const pct = Math.round((num / 255) * 100);
                return pct + '%';
            } else if (num >= 0 && num <= 1) {
                // 0-1 float → percentage
                return Math.round(num * 100) + '%';
            } else if (num === 0) {
                return '0%';
            }
            // Already looks like a percentage value without the sign (e.g. user typed "50")
            // Treat values in 0-100 range as percentage if they were entered as plain numbers
            return Math.round(num) + '%';
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

        // Parse font declarations
        if (doc.font && typeof FontManager !== 'undefined') {
            FontManager.fromYAML(doc.font);
        }

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
            if (propDef.childLabel) continue;
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

        // Infer knob_style from knob part styles when importing
        if ((type === 'slider' || type === 'arc') && widget.styles.knob) {
            const ks = widget.styles.knob;
            if (ks.bg_opa === 'TRANSP' || (ks.width === 0 && ks.height === 0)) {
                widget.properties.knob_style = 'none';
            } else if (ks.radius !== undefined && parseInt(ks.radius) <= 4) {
                widget.properties.knob_style = 'bar';
                if (ks.width) widget.properties.knob_width = parseInt(ks.width);
                if (ks.height) widget.properties.knob_height = parseInt(ks.height);
            }
            const generatedKeys = ['radius', 'bg_color', 'bg_opa', 'border_width', 'shadow_width', 'width', 'height'];
            for (const k of generatedKeys) {
                delete widget.styles.knob[k];
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
            let code = actionYaml.lambda;
            // Strip lambda sentinel if present from parsing
            if (typeof code === 'string' && code.startsWith(LAMBDA_SENTINEL)) {
                code = code.slice(LAMBDA_SENTINEL.length);
            }
            return { type: 'lambda', fields: { code } };
        }

        const type = Object.keys(actionYaml)[0];
        const fields = actionYaml[type] || {};

        const result = { type, fields: {} };
        for (const [key, val] of Object.entries(fields)) {
            if (key === 'data' && typeof val === 'object') {
                // Convert data object back to YAML string for the editor field
                // Preserve lambda sentinels as !lambda tags in the string
                const dataLines = [];
                for (const [dk, dv] of Object.entries(val)) {
                    if (typeof dv === 'string' && dv.startsWith(LAMBDA_SENTINEL)) {
                        dataLines.push(`${dk}: !lambda "${dv.slice(LAMBDA_SENTINEL.length)}"`);
                    } else {
                        dataLines.push(`${dk}: ${dv}`);
                    }
                }
                result.fields[key] = dataLines.join('\n');
            } else if (typeof val === 'string' && val.startsWith(LAMBDA_SENTINEL)) {
                // Preserve lambda sentinel display for the user
                result.fields[key] = '!lambda "' + val.slice(LAMBDA_SENTINEL.length) + '"';
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
        // Handle numeric 0xRRGGBB (if js-yaml parsed it as a number)
        if (prop.includes('color') && typeof val === 'number') {
            return '#' + val.toString(16).padStart(6, '0');
        }
        return val;
    }

    // ---- Validation ----

    function validate(yamlStr) {
        const results = [];

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

        let lvglConfig = doc;
        if (doc.lvgl) {
            lvglConfig = doc.lvgl;
        } else {
            results.push({ type: 'warning', message: 'Missing top-level "lvgl:" key. ESPHome expects this.' });
        }

        // Track all IDs globally — ESPHome requires unique IDs across all pages
        const globalIds = new Set();

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
                        if (globalIds.has(page.id)) {
                            results.push({ type: 'error', message: `Page ID "${page.id}" conflicts with a widget ID` });
                        }
                        globalIds.add(page.id);

                        if (!isValidId(page.id)) {
                            results.push({ type: 'error', message: `Invalid page ID "${page.id}": must be a valid C identifier` });
                        }
                    }

                    if (page.widgets) {
                        validateWidgets(page.widgets, results, `pages[${i}]`, globalIds);
                    }
                }
            }
        }

        if (lvglConfig.widgets) {
            validateWidgets(lvglConfig.widgets, results, 'root', globalIds);
        }

        if (results.length === 0) {
            results.push({ type: 'success', message: 'YAML is valid ESPHome LVGL configuration.' });
        }

        return results;
    }

    function validateWidgets(widgets, results, path, globalIds) {
        if (!Array.isArray(widgets)) {
            results.push({ type: 'error', message: `${path}.widgets must be a list` });
            return;
        }

        // Use global ID set if provided, otherwise create local one
        const widgetIds = globalIds || new Set();
        for (let i = 0; i < widgets.length; i++) {
            const widgetYaml = widgets[i];
            const type = Object.keys(widgetYaml)[0];
            const props = widgetYaml[type];
            const wPath = `${path}.widgets[${i}]`;

            const def = LVGLWidgets.getWidgetDef(type);
            if (!def) {
                results.push({ type: 'warning', message: `${wPath}: Unknown widget type "${type}"` });
                continue;
            }

            if (!props || typeof props !== 'object') {
                results.push({ type: 'error', message: `${wPath}: Widget "${type}" must have properties object` });
                continue;
            }

            if (props.id) {
                if (widgetIds.has(props.id)) {
                    results.push({ type: 'error', message: `${wPath}: Duplicate ID "${props.id}" (IDs must be globally unique across all pages)` });
                }
                widgetIds.add(props.id);
                if (!isValidId(props.id)) {
                    results.push({ type: 'error', message: `${wPath}: Invalid ID "${props.id}": must be a valid C identifier` });
                }
            }

            if (props.width !== undefined && typeof props.width === 'number' && props.width <= 0) {
                results.push({ type: 'warning', message: `${wPath}: Width should be positive` });
            }
            if (props.height !== undefined && typeof props.height === 'number' && props.height <= 0) {
                results.push({ type: 'warning', message: `${wPath}: Height should be positive` });
            }

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

            if (type === 'arc') {
                if (props.arc_width !== undefined && props.arc_width <= 0) {
                    results.push({ type: 'warning', message: `${wPath}: Arc width should be positive` });
                }
            }

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

            for (const part of (def.parts || [])) {
                if (props[part] && typeof props[part] === 'object') {
                    for (const [styleProp] of Object.entries(props[part])) {
                        if (!LVGLWidgets.STYLE_PROPS[styleProp]) {
                            results.push({ type: 'info', message: `${wPath}.${part}: Unknown style property "${styleProp}"` });
                        }
                    }
                }
            }

            if (props.widgets && !def.canContain) {
                results.push({ type: 'warning', message: `${wPath}: Widget type "${type}" does not support child widgets` });
            }

            if (props.widgets) {
                validateWidgets(props.widgets, results, wPath, widgetIds);
            }
        }
    }

    function isValidId(id) {
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id);
    }

    // ---- Editor Integration ----

    function updateEditorFromState(designerState) {
        if (!codeMirrorEditor || isUpdatingFromEditor) return;
        isUpdatingFromDesigner = true;
        const yaml = generateYAML(designerState);
        codeMirrorEditor.setValue(yaml);
        isUpdatingFromDesigner = false;
        updateValidationStatus(validate(yaml));
    }

    function getEditorContent() {
        return codeMirrorEditor ? codeMirrorEditor.getValue() : '';
    }

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
            codeMirrorEditor.setValue(postProcessYaml(formatted));
            isUpdatingFromDesigner = false;
        } catch (e) {
            // If YAML is invalid, don't format
        }
    }

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

    /**
     * Export full device YAML (LVGL + sensors + bindings) as downloadable file.
     */
    function exportFullYAML(designerState) {
        const yaml = generateFullYAML(designerState);
        const blob = new Blob([yaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lvgl_device.yaml';
        a.click();
        URL.revokeObjectURL(url);
    }

    // ---- Public API ----
    return {
        init,
        generateYAML,
        generateFullYAML,
        parseYAML,
        validate,
        updateEditorFromState,
        getEditorContent,
        applyEditorToDesigner,
        validateEditorContent,
        formatEditor,
        exportYAML,
        exportFullYAML,
        LAMBDA_SENTINEL,
    };
})();
