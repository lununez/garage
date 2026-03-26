const jsyaml = require('js-yaml');

global.jsyaml = jsyaml;
global.FontManager = {
    toYAML: () => [
        { file: 'gfonts://Outfit', id: 'outfit_22', size: 22 },
        { file: 'gfonts://Outfit', id: 'outfit_16', size: 16 },
    ],
};
global.LVGLWidgets = {
    getWidgetDef: (type) => {
        const defs = {
            canvas: { properties: {}, parts: ['main'] },
            slider: {
                properties: {
                    min_value: { type: 'number', default: 0 },
                    max_value: { type: 'number', default: 100 },
                    value: { type: 'number', default: 50 },
                    knob_style: { type: 'enum', default: 'circle', yamlExclude: true },
                    knob_width: { type: 'number', default: null, yamlExclude: true },
                    knob_height: { type: 'number', default: null, yamlExclude: true },
                },
                parts: ['main', 'indicator', 'knob']
            },
            button: {
                properties: { text: { type: 'text', default: 'Button', childLabel: true } },
                parts: ['main'],
                canContain: true,
            },
            label: {
                properties: {
                    text: { type: 'text', default: 'Label' },
                    text_align: { type: 'enum', default: '', isStyle: true, yamlExclude: true },
                },
                parts: ['main']
            },
        };
        return defs[type] || null;
    },
    EVENTS: { on_press: {}, on_release: {}, on_click: {} },
    STYLE_PROPS: {},
};
global.EntityBinding = { generateConditionalActions: () => null };
global.CodeMirror = { fromTextArea: () => ({ on: () => {}, setValue: () => {}, getValue: () => '' }) };
global.document = { getElementById: () => null };

const code = require('fs').readFileSync('/home/user/garage/js/yaml-engine.js', 'utf8');
eval('global.YAMLEngine = ' + code.replace('const YAMLEngine =', ''));

const state = {
    pages: [
        {
            id: 'shade', name: 'Shade',
            widgets: [
                {
                    id: 'canvas_1', type: 'canvas', x: 0, y: 0, width: 170, height: 320,
                    properties: {},
                    styles: { main: { bg_color: '#344470', bg_opa: '100%' } },
                    events: {}, children: [],
                },
                {
                    id: 'shade_slider', type: 'slider', x: 41, y: 41, width: 89, height: 240,
                    properties: { knob_style: 'bar', knob_width: 95, knob_height: 4 },
                    styles: {
                        main: { bg_color: '#ffaa44', radius: 7, shadow_color: '#fbf8f4' },
                        indicator: { bg_color: '#ffeecc', shadow_width: 50, shadow_color: '#f5870a' },
                        knob: { shadow_color: '#ff9900' },
                    },
                    events: {}, children: [],
                },
                {
                    id: 'up_button', type: 'button', x: 35, y: 35, width: 100, height: 40,
                    properties: {},
                    styles: { main: { bg_opa: '0%', opa: '100%', text_color: '#ffeecc', text_font: 'montserrat_36', shadow_width: 9 } },
                    events: {
                        on_press: [{ type: 'homeassistant.action', fields: { action: 'cover.open_cover', data: 'entity_id: cover.right_window_shade' } }]
                    },
                    children: [{
                        id: 'up_arrow', type: 'label', x: 0, y: 9, width: 120, height: 30,
                        // This is how the designer stores it: literal backslash + U
                        properties: { text: '\\U000F0360' },
                        styles: { main: { text_font: 'montserrat_32' } },
                        events: {}, children: [],
                    }],
                },
                {
                    id: 'down_button', type: 'button', x: 35, y: 245, width: 100, height: 40,
                    properties: {},
                    styles: { main: { bg_opa: '0%', opa: '100%', text_color: '#ffa943', text_font: 'montserrat_36', shadow_width: 9 } },
                    events: {
                        on_press: [{ type: 'homeassistant.action', fields: { action: 'cover.close_cover', data: 'entity_id: cover.right_window_shade' } }]
                    },
                    children: [{
                        id: 'down_arrow', type: 'label', x: 0, y: 9, width: 120, height: 30,
                        properties: { text: '\\U000F035D' },
                        styles: { main: { text_font: 'montserrat_32' } },
                        events: {}, children: [],
                    }],
                },
            ],
        },
        {
            id: 'buttons', name: 'Buttons',
            widgets: [{
                id: 'button_3', type: 'button', x: 0, y: 0, width: 170, height: 64,
                properties: {},
                styles: { main: { text_font: 'outfit_16', radius: 0, pad_all: 15 } },
                events: {},
                children: [{
                    id: 'label_4', type: 'label', x: 0, y: 0, width: 100, height: 40,
                    properties: { text: 'LOW LIGHT', text_align: 'LEFT' },
                    styles: { main: { text_align: 'LEFT', pad_all: 30 } },
                    events: {}, children: [],
                }],
            }],
        },
    ],
};

const yaml = YAMLEngine.generateYAML(state);
console.log(yaml);
