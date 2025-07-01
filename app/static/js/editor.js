// ScriptPilot Code Editor Utilities
// This file contains additional editor-related utilities and extensions

// Debug function to test CodeMirror availability
function testCodeMirror() {
    if (window.CodeMirror) {
        console.log('CodeMirror is available:', Object.keys(window.CodeMirror));
        return true;
    } else {
        console.error('CodeMirror is not available');
        return false;
    }
}

// Test editor creation
function createTestEditor() {
    if (!testCodeMirror()) return;
    
    try {
        const { EditorView, basicSetup, oneDark } = window.CodeMirror;
        
        const testContainer = document.createElement('div');
        testContainer.style.cssText = 'height: 200px; border: 1px solid #ccc; margin: 10px;';
        document.body.appendChild(testContainer);
        
        const editor = new EditorView({
            extensions: [basicSetup, oneDark],
            doc: 'print("Hello from test editor!")',
            parent: testContainer
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
        
        if (window.CodeMirror) {
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

// Make functions available globally for debugging and use
window.testCodeMirror = testCodeMirror;
window.createTestEditor = createTestEditor;
window.createFallbackEditor = createFallbackEditor;
window.waitForCodeMirror = waitForCodeMirror;
