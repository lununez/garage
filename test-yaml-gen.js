const jsyaml = require('js-yaml');

global.jsyaml = jsyaml;
global.FontManager = {
    toYAML: () => [
        { file: 'gfonts://Outfit', id: 'outfit_22', size: 22 },
        { file: 'gfonts://Outfit', id: 'outfit_16', size: 16 },
    ],
    fromYAML: () => {},
};

// Full STYLE_PROPS from widgets.js for validation
const STYLE_PROPS = {
    bg_color: {}, bg_opa: {}, bg_grad_color: {}, bg_grad_dir: {},
    bg_main_stop: {}, bg_grad_stop: {}, bg_dither_mode: {},
    border_color: {}, border_width: {}, border_opa: {}, border_side: {},
    outline_color: {}, outline_width: {}, outline_opa: {}, outline_pad: {},
    shadow_color: {}, shadow_width: {}, shadow_opa: {},
    shadow_ofs_x: {}, shadow_ofs_y: {}, shadow_spread: {},
    radius: {}, opa: {}, clip_corner: {},
    pad_all: {}, pad_top: {}, pad_bottom: {}, pad_left: {}, pad_right: {},
    pad_row: {}, pad_column: {},
    text_color: {}, text_font: {}, text_opa: {}, text_align: {},
    text_letter_space: {}, text_line_space: {},
    image_recolor: {}, image_recolor_opa: {},
};

global.LVGLWidgets = {
    getWidgetDef: (type) => {
        const defs = {
            obj: { properties: {}, parts: ['main'], canContain: true },
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
    STYLE_PROPS: STYLE_PROPS,
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
                    // canvas without draw actions → should become 'obj' in output
                    id: 'bg_panel', type: 'canvas', x: 0, y: 0, width: 170, height: 320,
                    properties: {},
                    styles: { main: { bg_color: '#344470', bg_opa: 'COVER' } },
                    events: {}, children: [],
                },
                {
                    id: 'shade_slider', type: 'slider', x: 41, y: 41, width: 89, height: 240,
                    properties: { knob_style: 'bar', knob_width: 95, knob_height: 4 },
                    styles: {
                        main: { bg_color: '#ffaa44', radius: 7 },
                        indicator: { bg_color: '#ffeecc', shadow_width: 50, shadow_color: '#f5870a' },
                        knob: { shadow_color: '#ff9900' },
                    },
                    events: {}, children: [],
                },
                {
                    id: 'up_button', type: 'button', x: 35, y: 35, width: 100, height: 40,
                    properties: {},
                    styles: { main: { bg_opa: 'TRANSP', text_color: '#ffeecc', text_font: 'montserrat_36' } },
                    events: {
                        on_press: [{ type: 'homeassistant.action', fields: { action: 'cover.open_cover', data: 'entity_id: cover.right_window_shade' } }]
                    },
                    children: [{
                        id: 'up_arrow', type: 'label', x: 0, y: 9, width: 120, height: 30,
                        properties: { text: '\\uF077' },
                        styles: { main: { text_font: 'montserrat_32' } },
                        events: {}, children: [],
                    }],
                },
                {
                    id: 'down_button', type: 'button', x: 35, y: 245, width: 100, height: 40,
                    properties: {},
                    styles: { main: { bg_opa: 'TRANSP', text_color: '#ffa943', text_font: 'montserrat_36' } },
                    events: {
                        on_press: [{ type: 'homeassistant.action', fields: { action: 'cover.close_cover', data: 'entity_id: cover.right_window_shade' } }]
                    },
                    children: [{
                        id: 'down_arrow', type: 'label', x: 0, y: 9, width: 120, height: 30,
                        properties: { text: '\\uF078' },
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

console.log('=== Generated YAML ===');
const yaml = YAMLEngine.generateYAML(state);
console.log(yaml);

// Validate the output
console.log('\n=== Validation Checks ===');
const lines = yaml.split('\n');
const checks = {
    'canvas mapped to obj': /^\s+- obj:/m.test(yaml),
    'no main: wrapper': !lines.some(l => /^\s+main:/.test(l)),
    'colors unquoted': /bg_color: 0x[0-9A-F]{6}\s*$/m.test(yaml),
    'opacity unquoted': /bg_opa: (COVER|TRANSP|\d+%)\s*$/m.test(yaml),
    'y key unquoted': lines.some(l => /^\s+y: \d+/.test(l)),
    'indicator nested': /^\s+indicator:/m.test(yaml),
    'knob nested': /^\s+knob:/m.test(yaml),
    'icon text double-quoted': /text: "\\u[0-9A-Fa-f]{4}"/.test(yaml),
    'has widgets nesting': /^\s+widgets:/m.test(yaml),
};

let allPassed = true;
for (const [name, passed] of Object.entries(checks)) {
    console.log(`  ${passed ? 'PASS' : 'FAIL'}: ${name}`);
    if (!passed) allPassed = false;
}

// Round-trip test: parse the generated YAML back
console.log('\n=== Round-trip Parse Test ===');
try {
    const parsed = YAMLEngine.parseYAML(yaml);
    console.log(`  Pages: ${parsed.pages.length}`);
    for (const page of parsed.pages) {
        console.log(`  Page "${page.id}": ${page.widgets.length} widgets`);
        for (const w of page.widgets) {
            const styleCount = Object.keys(w.styles.main || {}).length;
            console.log(`    ${w.type} "${w.id}" (${w.width}x${w.height}) - ${styleCount} main styles`);
        }
    }
    console.log('  Round-trip: OK');
} catch (e) {
    console.log(`  Round-trip FAILED: ${e.message}`);
}

console.log(`\n=== Overall: ${allPassed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} ===`);
