// ScriptPilot Code Editor Utilities
// This file contains CodeMirror 5 editor utilities and extensions

// Debug function to test CodeMirror availability
function testCodeMirror() {
    if (window.CodeMirror && typeof window.CodeMirror === 'function') {
        console.log('CodeMirror 5 is available:', Object.keys(window.CodeMirror));
        return true;
    } else {
        console.error('CodeMirror 5 is not available');
        return false;
    }
}

// Test editor creation
function createTestEditor() {
    if (!testCodeMirror()) return;
    
    try {
        const testContainer = document.createElement('div');
        testContainer.style.cssText = 'height: 200px; border: 1px solid #ccc; margin: 10px;';
        document.body.appendChild(testContainer);
        
        const editor = window.CodeMirror(testContainer, {
            value: 'print("Hello from test editor!")',
            mode: 'python',
            theme: 'monokai',
            lineNumbers: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            styleActiveLine: true
        });
        
        console.log('Test editor created successfully:', editor);
        
        // Remove after 5 seconds
        setTimeout(() => {
            testContainer.remove();
            console.log('Test editor removed');
        }, 5000);
        
    } catch (error) {
        console.error('Error creating test editor:', error);
    }
}

// Fallback textarea editor for when CodeMirror fails
function createFallbackEditor(container, content = '') {
    console.log('Creating fallback textarea editor');
    
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.style.cssText = `
        width: 100%;
        height: 400px;
        background: #1e1e1e;
        color: #d4d4d4;
        border: 1px solid #404040;
        padding: 10px;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 14px;
        line-height: 1.5;
        resize: vertical;
        outline: none;
        tab-size: 4;
    `;
    
    // Add event listeners for cursor tracking
    textarea.addEventListener('input', () => {
        if (window.app && window.app.updateEditorStatus) {
            window.app.updateEditorStatus();
        }
    });
    
    textarea.addEventListener('click', () => {
        if (window.app && window.app.updateCursorPosition) {
            window.app.updateCursorPosition();
        }
    });
    
    textarea.addEventListener('keyup', () => {
        if (window.app && window.app.updateCursorPosition) {
            window.app.updateCursorPosition();
        }
    });
    
    // Clear container and add textarea
    container.innerHTML = '';
    container.appendChild(textarea);
    
    return {
        getValue: () => textarea.value,
        setValue: (value) => { 
            textarea.value = value;
            if (window.app && window.app.updateEditorStatus) {
                window.app.updateEditorStatus();
            }
        },
        focus: () => textarea.focus(),
        getElement: () => textarea
    };
}

// Wait for CodeMirror to be ready
function waitForCodeMirror(callback, maxAttempts = 50) {
    let attempts = 0;
    
    const check = () => {
        attempts++;
        
        if (window.CodeMirror && typeof window.CodeMirror === 'function') {
            console.log(`CodeMirror ready after ${attempts} attempts`);
            callback(true);
        } else if (attempts >= maxAttempts) {
            console.error(`CodeMirror not available after ${attempts} attempts`);
            callback(false);
        } else {
            setTimeout(check, 100);
        }
    };
    
    check();
}

// Create a CodeMirror 5 editor
function createCodeMirrorEditor(container, content = '', language = 'python') {
    if (!window.CodeMirror) {
        console.error('CodeMirror not available');
        return null;
    }
    
    // Map language to CodeMirror mode
    const modeMap = {
        'python': 'python',
        'powershell': 'powershell',
        'bash': 'shell',
        'sh': 'shell',
        'javascript': 'javascript',
        'js': 'javascript'
    };
    
    const mode = modeMap[language.toLowerCase()] || 'python';
    
    try {
        const editor = window.CodeMirror(container, {
            value: content,
            mode: mode,
            theme: 'monokai',
            lineNumbers: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            styleActiveLine: true,
            indentUnit: 4,
            tabSize: 4,
            lineWrapping: false,
            extraKeys: {
                "Tab": "indentMore",
                "Shift-Tab": "indentLess"
            }
        });
        
        // Add event listeners for cursor tracking
        editor.on('cursorActivity', () => {
            if (window.app && window.app.updateCursorPosition) {
                window.app.updateCursorPosition();
            }
        });
        
        editor.on('change', () => {
            if (window.app && window.app.updateEditorStatus) {
                window.app.updateEditorStatus();
            }
        });
        
        return editor;
    } catch (error) {
        console.error('Error creating CodeMirror editor:', error);
        return null;
    }
}

// Make functions available globally for debugging and use
window.testCodeMirror = testCodeMirror;
window.createTestEditor = createTestEditor;
window.createFallbackEditor = createFallbackEditor;
window.waitForCodeMirror = waitForCodeMirror;
window.createCodeMirrorEditor = createCodeMirrorEditor;
