/**
 * LVGL Widget Definitions for ESPHome
 * Complete registry of all supported LVGL widgets with their properties,
 * parts, default values, and categories.
 */

const LVGLWidgets = (() => {

    // ---- Common Style Properties ----
    const STYLE_PROPS = {
        bg_color:    { type: 'color', default: null, label: 'Background Color' },
        bg_opa:      { type: 'opacity', default: null, label: 'Background Opacity' },
        bg_grad:     { type: 'string', default: null, label: 'Background Gradient' },
        border_color:{ type: 'color', default: null, label: 'Border Color' },
        border_width:{ type: 'number', default: null, label: 'Border Width', min: 0 },
        border_opa:  { type: 'opacity', default: null, label: 'Border Opacity' },
        border_side: { type: 'enum', default: null, label: 'Border Side', options: ['', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'FULL', 'NONE'] },
        outline_color: { type: 'color', default: null, label: 'Outline Color' },
        outline_width: { type: 'number', default: null, label: 'Outline Width', min: 0 },
        outline_opa:   { type: 'opacity', default: null, label: 'Outline Opacity' },
        outline_pad:   { type: 'number', default: null, label: 'Outline Pad' },
        shadow_color:  { type: 'color', default: null, label: 'Shadow Color' },
        shadow_width:  { type: 'number', default: null, label: 'Shadow Width', min: 0 },
        shadow_opa:    { type: 'opacity', default: null, label: 'Shadow Opacity' },
        shadow_ofs_x:  { type: 'number', default: null, label: 'Shadow X Offset' },
        shadow_ofs_y:  { type: 'number', default: null, label: 'Shadow Y Offset' },
        shadow_spread: { type: 'number', default: null, label: 'Shadow Spread' },
        radius:        { type: 'number', default: null, label: 'Corner Radius', min: 0 },
        opa:           { type: 'opacity', default: null, label: 'Opacity' },
        clip_corner:   { type: 'boolean', default: null, label: 'Clip Corner' },
        pad_all:       { type: 'number', default: null, label: 'Padding All' },
        pad_top:       { type: 'number', default: null, label: 'Padding Top' },
        pad_bottom:    { type: 'number', default: null, label: 'Padding Bottom' },
        pad_left:      { type: 'number', default: null, label: 'Padding Left' },
        pad_right:     { type: 'number', default: null, label: 'Padding Right' },
        pad_row:       { type: 'number', default: null, label: 'Padding Row' },
        pad_column:    { type: 'number', default: null, label: 'Padding Column' },
        text_color:    { type: 'color', default: null, label: 'Text Color' },
        text_font:     { type: 'string', default: null, label: 'Text Font' },
        text_opa:      { type: 'opacity', default: null, label: 'Text Opacity' },
        text_align:    { type: 'enum', default: null, label: 'Text Align', options: ['', 'LEFT', 'CENTER', 'RIGHT', 'AUTO'] },
        text_letter_space: { type: 'number', default: null, label: 'Letter Spacing' },
        text_line_space:   { type: 'number', default: null, label: 'Line Spacing' },
        image_recolor:     { type: 'color', default: null, label: 'Image Recolor' },
        image_recolor_opa: { type: 'opacity', default: null, label: 'Image Recolor Opacity' },
    };

    // ---- Common Position/Size Properties ----
    const LAYOUT_PROPS = {
        x:       { type: 'number', default: 0, label: 'X Position' },
        y:       { type: 'number', default: 0, label: 'Y Position' },
        width:   { type: 'size', default: 100, label: 'Width' },
        height:  { type: 'size', default: 50, label: 'Height' },
        align:   { type: 'enum', default: '', label: 'Alignment',
                   options: ['', 'CENTER', 'TOP_LEFT', 'TOP_MID', 'TOP_RIGHT',
                            'BOTTOM_LEFT', 'BOTTOM_MID', 'BOTTOM_RIGHT',
                            'LEFT_MID', 'RIGHT_MID'] },
        layout:  { type: 'enum', default: '', label: 'Layout', options: ['', 'FLEX', 'GRID'] },
        flex_flow: { type: 'enum', default: '', label: 'Flex Flow',
                     options: ['', 'ROW', 'COLUMN', 'ROW_WRAP', 'COLUMN_WRAP', 'ROW_REVERSE', 'COLUMN_REVERSE'] },
        flex_align_main:  { type: 'enum', default: '', label: 'Main Axis Align',
                           options: ['', 'START', 'CENTER', 'END', 'SPACE_EVENLY', 'SPACE_AROUND', 'SPACE_BETWEEN'] },
        flex_align_cross: { type: 'enum', default: '', label: 'Cross Axis Align',
                           options: ['', 'START', 'CENTER', 'END'] },
        flex_align_track: { type: 'enum', default: '', label: 'Track Align',
                           options: ['', 'START', 'CENTER', 'END', 'SPACE_EVENLY', 'SPACE_AROUND', 'SPACE_BETWEEN'] },
    };

    // ---- Widget State Properties ----
    const STATE_STYLES = ['DEFAULT', 'PRESSED', 'FOCUSED', 'DISABLED', 'CHECKED'];

    // ---- ESPHome Event/Action Definitions ----
    // Events that LVGL widgets can trigger, with associated ESPHome actions
    const EVENTS = {
        on_click:         { label: 'On Click', widgets: ['button', 'obj', 'image', 'label', 'buttonmatrix'] },
        on_press:         { label: 'On Press', widgets: '*' },
        on_release:       { label: 'On Release', widgets: '*' },
        on_long_press:    { label: 'On Long Press', widgets: '*' },
        on_long_press_repeat: { label: 'On Long Press Repeat', widgets: '*' },
        on_short_click:   { label: 'On Short Click', widgets: '*' },
        on_value_change:  { label: 'On Value Change', widgets: ['slider', 'arc', 'bar', 'roller', 'dropdown', 'spinbox', 'switch', 'checkbox'] },
        on_focus:         { label: 'On Focus', widgets: '*' },
        on_defocus:       { label: 'On Defocus', widgets: '*' },
    };

    // ESPHome action types that can be used in event handlers
    const ACTION_TYPES = {
        'homeassistant.action': {
            label: 'Home Assistant Action',
            fields: {
                action: { type: 'string', label: 'Action (e.g. light.turn_on)', required: true },
                data: { type: 'yaml_map', label: 'Data (YAML key: value pairs)' },
            },
        },
        'homeassistant.service': {
            label: 'Home Assistant Service (legacy)',
            fields: {
                service: { type: 'string', label: 'Service (e.g. light.turn_on)', required: true },
                data: { type: 'yaml_map', label: 'Data (YAML key: value pairs)' },
            },
        },
        'logger.log': {
            label: 'Log Message',
            fields: {
                format: { type: 'string', label: 'Format String', required: true },
                args: { type: 'string', label: 'Arguments' },
                level: { type: 'enum', label: 'Level', options: ['DEBUG', 'INFO', 'WARN', 'ERROR'] },
            },
        },
        'lvgl.widget.update': {
            label: 'Update LVGL Widget',
            fields: {
                id: { type: 'string', label: 'Target Widget ID', required: true },
            },
        },
        'lvgl.page.show': {
            label: 'Show LVGL Page',
            fields: {
                id: { type: 'string', label: 'Page ID', required: true },
                animation: { type: 'enum', label: 'Animation', options: ['', 'NONE', 'MOVE_LEFT', 'MOVE_RIGHT', 'FADE_IN'] },
            },
        },
        'light.turn_on': {
            label: 'Turn On Light',
            fields: {
                id: { type: 'string', label: 'Light ID', required: true },
                brightness: { type: 'string', label: 'Brightness (0-255 or lambda)' },
                color_temp: { type: 'string', label: 'Color Temperature' },
                red: { type: 'string', label: 'Red (0-1)' },
                green: { type: 'string', label: 'Green (0-1)' },
                blue: { type: 'string', label: 'Blue (0-1)' },
                transition_length: { type: 'string', label: 'Transition (ms)' },
            },
        },
        'light.turn_off': {
            label: 'Turn Off Light',
            fields: {
                id: { type: 'string', label: 'Light ID', required: true },
            },
        },
        'switch.turn_on': {
            label: 'Turn On Switch',
            fields: { id: { type: 'string', label: 'Switch ID', required: true } },
        },
        'switch.turn_off': {
            label: 'Turn Off Switch',
            fields: { id: { type: 'string', label: 'Switch ID', required: true } },
        },
        'switch.toggle': {
            label: 'Toggle Switch',
            fields: { id: { type: 'string', label: 'Switch ID', required: true } },
        },
        'output.set_level': {
            label: 'Set Output Level',
            fields: {
                id: { type: 'string', label: 'Output ID', required: true },
                level: { type: 'string', label: 'Level (0-1 or lambda)' },
            },
        },
        'lambda': {
            label: 'Lambda (C++ code)',
            fields: {
                code: { type: 'text', label: 'C++ code' },
            },
        },
    };

    // ---- Widget Definitions ----
    const WIDGETS = {

        // --- Containers ---
        obj: {
            label: 'Object',
            icon: '▣',
            category: 'Containers',
            description: 'Base container object',
            canContain: true,
            defaultSize: { width: 150, height: 100 },
            properties: {
                scrollbar_mode: { type: 'enum', default: '', label: 'Scrollbar', options: ['', 'OFF', 'ON', 'ACTIVE', 'AUTO'] },
            },
            parts: ['main', 'scrollbar'],
        },

        // --- Text & Display ---
        label: {
            label: 'Label',
            icon: 'T',
            category: 'Text & Display',
            description: 'Text display widget',
            canContain: false,
            defaultSize: { width: 120, height: 30 },
            properties: {
                text: { type: 'string', default: 'Label', label: 'Text' },
                long_mode: { type: 'enum', default: '', label: 'Long Mode',
                            options: ['', 'WRAP', 'DOT', 'SCROLL', 'SCROLL_CIRCULAR', 'CLIP'] },
                recolor: { type: 'boolean', default: false, label: 'Recolor' },
            },
            parts: ['main'],
        },

        // --- Input Controls ---
        button: {
            label: 'Button',
            icon: '⬜',
            category: 'Input Controls',
            description: 'Clickable button widget',
            canContain: true,
            defaultSize: { width: 100, height: 40 },
            properties: {
                checkable: { type: 'boolean', default: false, label: 'Checkable' },
            },
            parts: ['main'],
        },

        slider: {
            label: 'Slider',
            icon: '⬌',
            category: 'Input Controls',
            description: 'Adjustable slider (horizontal or vertical)',
            canContain: false,
            defaultSize: { width: 200, height: 20 },
            properties: {
                min_value: { type: 'number', default: 0, label: 'Min Value' },
                max_value: { type: 'number', default: 100, label: 'Max Value' },
                value:     { type: 'number', default: 50, label: 'Value' },
                adjustable: { type: 'boolean', default: true, label: 'Adjustable', yamlMap: 'disabled', yamlInvert: true },
                animated:  { type: 'boolean', default: false, label: 'Animated' },
                mode:      { type: 'enum', default: '', label: 'Mode', options: ['', 'NORMAL', 'SYMMETRICAL', 'RANGE'] },
                knob_style: { type: 'enum', default: 'circle', label: 'Knob Style',
                             options: ['circle', 'bar', 'none', 'image'], yamlExclude: true },
                knob_image: { type: 'string', default: '', label: 'Knob Image (URL)', yamlExclude: true },
                knob_width: { type: 'number', default: null, label: 'Knob Width', yamlExclude: true },
                knob_height: { type: 'number', default: null, label: 'Knob Height', yamlExclude: true },
            },
            parts: ['main', 'indicator', 'knob'],
        },

        arc: {
            label: 'Arc',
            icon: '◠',
            category: 'Input Controls',
            description: 'Circular arc control',
            canContain: false,
            defaultSize: { width: 100, height: 100 },
            properties: {
                min_value:  { type: 'number', default: 0, label: 'Min Value' },
                max_value:  { type: 'number', default: 100, label: 'Max Value' },
                value:      { type: 'number', default: 50, label: 'Value' },
                adjustable: { type: 'boolean', default: true, label: 'Adjustable', yamlMap: 'disabled', yamlInvert: true },
                start_angle: { type: 'number', default: 135, label: 'Start Angle', min: 0, max: 360 },
                end_angle:   { type: 'number', default: 45, label: 'End Angle', min: 0, max: 360 },
                rotation:    { type: 'number', default: 0, label: 'Rotation' },
                mode:        { type: 'enum', default: '', label: 'Mode', options: ['', 'NORMAL', 'REVERSE', 'SYMMETRICAL'] },
                arc_width:   { type: 'number', default: 10, label: 'Arc Width' },
            },
            parts: ['main', 'indicator', 'knob'],
        },

        bar: {
            label: 'Bar',
            icon: '▬',
            category: 'Input Controls',
            description: 'Progress/level bar',
            canContain: false,
            defaultSize: { width: 150, height: 16 },
            properties: {
                min_value: { type: 'number', default: 0, label: 'Min Value' },
                max_value: { type: 'number', default: 100, label: 'Max Value' },
                value:     { type: 'number', default: 50, label: 'Value' },
                animated:  { type: 'boolean', default: false, label: 'Animated' },
                mode:      { type: 'enum', default: '', label: 'Mode', options: ['', 'NORMAL', 'SYMMETRICAL', 'RANGE'] },
            },
            parts: ['main', 'indicator'],
        },

        switch: {
            label: 'Switch',
            icon: '⊘',
            category: 'Input Controls',
            description: 'Toggle switch',
            canContain: false,
            defaultSize: { width: 50, height: 26 },
            properties: {
                checked: { type: 'boolean', default: false, label: 'Checked' },
            },
            parts: ['main', 'indicator', 'knob'],
        },

        checkbox: {
            label: 'Checkbox',
            icon: '☑',
            category: 'Input Controls',
            description: 'Toggle checkbox with label',
            canContain: false,
            defaultSize: { width: 120, height: 24 },
            properties: {
                text:    { type: 'string', default: 'Checkbox', label: 'Text' },
                checked: { type: 'boolean', default: false, label: 'Checked' },
            },
            parts: ['main', 'indicator'],
        },

        dropdown: {
            label: 'Dropdown',
            icon: '▾',
            category: 'Input Controls',
            description: 'Dropdown selection list',
            canContain: false,
            defaultSize: { width: 140, height: 32 },
            properties: {
                options: { type: 'text', default: 'Option 1\nOption 2\nOption 3', label: 'Options (one per line)' },
                selected_index: { type: 'number', default: 0, label: 'Selected Index', min: 0 },
                dir: { type: 'enum', default: '', label: 'Open Direction', options: ['', 'BOTTOM', 'TOP', 'LEFT', 'RIGHT'] },
            },
            parts: ['main', 'indicator', 'selected'],
        },

        roller: {
            label: 'Roller',
            icon: '⊞',
            category: 'Input Controls',
            description: 'Spinning roller selector',
            canContain: false,
            defaultSize: { width: 100, height: 80 },
            properties: {
                options: { type: 'text', default: 'Item 1\nItem 2\nItem 3\nItem 4\nItem 5', label: 'Options (one per line)' },
                selected_index: { type: 'number', default: 2, label: 'Selected Index', min: 0 },
                mode: { type: 'enum', default: '', label: 'Mode', options: ['', 'NORMAL', 'INFINITE'] },
                visible_row_count: { type: 'number', default: 3, label: 'Visible Rows', min: 1 },
            },
            parts: ['main', 'selected'],
        },

        spinbox: {
            label: 'Spinbox',
            icon: '±',
            category: 'Input Controls',
            description: 'Numeric spinner input',
            canContain: false,
            defaultSize: { width: 120, height: 32 },
            properties: {
                value:     { type: 'number', default: 0, label: 'Value' },
                min_value: { type: 'number', default: -99, label: 'Min Value' },
                max_value: { type: 'number', default: 99, label: 'Max Value' },
                step:      { type: 'number', default: 1, label: 'Step' },
                digit_count: { type: 'number', default: 3, label: 'Digit Count', min: 1, max: 10 },
                decimal_count: { type: 'number', default: 0, label: 'Decimal Count', min: 0 },
            },
            parts: ['main', 'cursor'],
        },

        textarea: {
            label: 'Textarea',
            icon: '⊡',
            category: 'Text & Display',
            description: 'Multi-line text input',
            canContain: false,
            defaultSize: { width: 180, height: 80 },
            properties: {
                text:       { type: 'text', default: '', label: 'Text' },
                placeholder: { type: 'string', default: 'Type here...', label: 'Placeholder' },
                max_length: { type: 'number', default: null, label: 'Max Length', min: 0 },
                one_line:   { type: 'boolean', default: false, label: 'One Line' },
                password_mode: { type: 'boolean', default: false, label: 'Password Mode' },
                accepted_chars: { type: 'string', default: '', label: 'Accepted Chars' },
            },
            parts: ['main', 'cursor'],
        },

        // --- Visual Widgets ---
        image: {
            label: 'Image',
            icon: '🖼',
            category: 'Visual',
            description: 'Image display',
            canContain: false,
            defaultSize: { width: 80, height: 80 },
            properties: {
                src:      { type: 'string', default: '', label: 'Source ID' },
                pivot_x:  { type: 'number', default: null, label: 'Pivot X' },
                pivot_y:  { type: 'number', default: null, label: 'Pivot Y' },
                angle:    { type: 'number', default: null, label: 'Angle' },
                zoom:     { type: 'number', default: null, label: 'Zoom' },
                antialias: { type: 'boolean', default: true, label: 'Antialias' },
                offset_x: { type: 'number', default: null, label: 'Offset X' },
                offset_y: { type: 'number', default: null, label: 'Offset Y' },
            },
            parts: ['main'],
        },

        animimg: {
            label: 'Anim Image',
            icon: '🎞',
            category: 'Visual',
            description: 'Animated image sequence',
            canContain: false,
            defaultSize: { width: 80, height: 80 },
            properties: {
                src:      { type: 'text', default: '', label: 'Source IDs (one per line)' },
                duration: { type: 'number', default: 1000, label: 'Duration (ms)' },
                repeat_count: { type: 'number', default: null, label: 'Repeat Count' },
                auto_start: { type: 'boolean', default: true, label: 'Auto Start' },
            },
            parts: ['main'],
        },

        led: {
            label: 'LED',
            icon: '●',
            category: 'Visual',
            description: 'LED indicator light',
            canContain: false,
            defaultSize: { width: 24, height: 24 },
            properties: {
                color:      { type: 'color', default: '#00ff00', label: 'Color' },
                brightness: { type: 'number', default: 255, label: 'Brightness', min: 0, max: 255 },
            },
            parts: ['main'],
        },

        line: {
            label: 'Line',
            icon: '╲',
            category: 'Visual',
            description: 'Line drawing',
            canContain: false,
            defaultSize: { width: 100, height: 100 },
            properties: {
                points: { type: 'text', default: '0,0\n100,100', label: 'Points (x,y per line)' },
                line_color: { type: 'color', default: '#ffffff', label: 'Line Color' },
                line_width: { type: 'number', default: 2, label: 'Line Width', min: 1 },
                line_rounded: { type: 'boolean', default: false, label: 'Rounded' },
            },
            parts: ['main'],
        },

        meter: {
            label: 'Meter',
            icon: '⊚',
            category: 'Visual',
            description: 'Gauge/dial meter',
            canContain: false,
            defaultSize: { width: 120, height: 120 },
            properties: {
                scale_label: { type: 'string', default: '', label: 'Scale Label' },
                scale_ticks_count: { type: 'number', default: 11, label: 'Tick Count', min: 2 },
                scale_ticks_length: { type: 'number', default: 8, label: 'Tick Length' },
                scale_ticks_width: { type: 'number', default: 2, label: 'Tick Width' },
                scale_ticks_color: { type: 'color', default: '#808080', label: 'Tick Color' },
                scale_range_from: { type: 'number', default: 0, label: 'Range From' },
                scale_range_to: { type: 'number', default: 100, label: 'Range To' },
                scale_angle_range: { type: 'number', default: 270, label: 'Angle Range' },
                scale_rotation: { type: 'number', default: 135, label: 'Rotation' },
                indicator_value: { type: 'number', default: 50, label: 'Indicator Value' },
            },
            parts: ['main', 'indicator', 'ticks'],
        },

        qrcode: {
            label: 'QR Code',
            icon: '⊞',
            category: 'Visual',
            description: 'QR code display',
            canContain: false,
            defaultSize: { width: 100, height: 100 },
            properties: {
                text:       { type: 'string', default: 'https://esphome.io', label: 'Text/URL' },
                dark_color: { type: 'color', default: '#000000', label: 'Dark Color' },
                light_color: { type: 'color', default: '#ffffff', label: 'Light Color' },
            },
            parts: ['main'],
        },

        spinner: {
            label: 'Spinner',
            icon: '◌',
            category: 'Visual',
            description: 'Loading spinner animation',
            canContain: false,
            defaultSize: { width: 50, height: 50 },
            properties: {
                arc_length: { type: 'number', default: 60, label: 'Arc Length (deg)', min: 1, max: 360 },
                spin_time:  { type: 'number', default: 1000, label: 'Spin Time (ms)' },
                arc_width:  { type: 'number', default: 5, label: 'Arc Width' },
                arc_color:  { type: 'color', default: '#6c8cff', label: 'Arc Color' },
            },
            parts: ['main', 'indicator'],
        },

        canvas: {
            label: 'Canvas',
            icon: '⬚',
            category: 'Visual',
            description: 'Custom drawing surface',
            canContain: false,
            defaultSize: { width: 150, height: 100 },
            properties: {},
            parts: ['main'],
        },

        // --- Container Widgets ---
        buttonmatrix: {
            label: 'Button Matrix',
            icon: '⊞',
            category: 'Containers',
            description: 'Grid of lightweight buttons',
            canContain: false,
            defaultSize: { width: 200, height: 80 },
            properties: {
                rows: { type: 'text', default: 'A,B,C\n1,2,3', label: 'Button Rows (comma-separated)' },
                one_checked: { type: 'boolean', default: false, label: 'One Checked' },
            },
            parts: ['main', 'items'],
        },

        tabview: {
            label: 'Tabview',
            icon: '⊟',
            category: 'Containers',
            description: 'Tabbed interface container',
            canContain: true,
            defaultSize: { width: 250, height: 150 },
            properties: {
                tab_labels: { type: 'text', default: 'Tab 1\nTab 2\nTab 3', label: 'Tab Labels (one per line)' },
                selected_tab: { type: 'number', default: 0, label: 'Selected Tab', min: 0 },
                position: { type: 'enum', default: 'TOP', label: 'Tab Position', options: ['TOP', 'BOTTOM', 'LEFT', 'RIGHT'] },
            },
            parts: ['main', 'items'],
        },

        tileview: {
            label: 'Tileview',
            icon: '⬡',
            category: 'Containers',
            description: 'Tile-based navigation',
            canContain: true,
            defaultSize: { width: 200, height: 150 },
            properties: {
                tile_id: { type: 'number', default: 0, label: 'Active Tile', min: 0 },
            },
            parts: ['main', 'scrollbar'],
        },

        keyboard: {
            label: 'Keyboard',
            icon: '⌨',
            category: 'Input Controls',
            description: 'On-screen keyboard',
            canContain: false,
            defaultSize: { width: 300, height: 120 },
            properties: {
                mode: { type: 'enum', default: 'TEXT_LOWER', label: 'Mode',
                        options: ['TEXT_LOWER', 'TEXT_UPPER', 'SPECIAL', 'NUMBER'] },
                textarea: { type: 'string', default: '', label: 'Target Textarea ID' },
            },
            parts: ['main', 'items'],
        },

        msgbox: {
            label: 'Message Box',
            icon: '⊡',
            category: 'Containers',
            description: 'Dialog message box',
            canContain: false,
            defaultSize: { width: 220, height: 120 },
            properties: {
                title:    { type: 'string', default: 'Title', label: 'Title' },
                body:     { type: 'text', default: 'Message body text', label: 'Body Text' },
                buttons:  { type: 'text', default: 'OK\nCancel', label: 'Buttons (one per line)' },
                close_button: { type: 'boolean', default: true, label: 'Show Close Button' },
            },
            parts: ['main'],
        },
    };

    // ---- Category Order ----
    const CATEGORIES = [
        'Input Controls',
        'Text & Display',
        'Visual',
        'Containers',
    ];

    // ---- Public API ----
    return {
        WIDGETS,
        CATEGORIES,
        STYLE_PROPS,
        LAYOUT_PROPS,
        STATE_STYLES,
        EVENTS,
        ACTION_TYPES,

        getWidgetDef(type) {
            return WIDGETS[type] || null;
        },

        getWidgetsByCategory() {
            const result = {};
            for (const cat of CATEGORIES) {
                result[cat] = [];
            }
            for (const [type, def] of Object.entries(WIDGETS)) {
                const cat = def.category;
                if (!result[cat]) result[cat] = [];
                result[cat].push({ type, ...def });
            }
            return result;
        },

        getDefaultProperties(type) {
            const def = WIDGETS[type];
            if (!def) return {};
            const props = {};
            for (const [key, prop] of Object.entries(def.properties)) {
                if (prop.default !== null && prop.default !== undefined) {
                    props[key] = prop.default;
                }
            }
            return props;
        },

        getDefaultStyles(type) {
            const def = WIDGETS[type];
            if (!def) return {};
            const styles = {};
            for (const part of (def.parts || ['main'])) {
                styles[part] = {};
            }
            return styles;
        },

        getAllWidgetTypes() {
            return Object.keys(WIDGETS);
        },

        canContainChildren(type) {
            const def = WIDGETS[type];
            return def ? def.canContain : false;
        },

        getEventsForWidget(type) {
            const result = {};
            for (const [event, def] of Object.entries(EVENTS)) {
                if (def.widgets === '*' || def.widgets.includes(type)) {
                    result[event] = def;
                }
            }
            return result;
        },
    };
})();
