import packageInfo from './package.json';

(function(){
  const toolbar = document.getElementById('toolbar');
  const spacer = document.getElementById('spacer');
  const mainArea = document.getElementById('mainArea');
  const outlineArea = document.getElementById('outlineArea');
  const editorWrapper = document.getElementById('editorWrapper');
  const currentLineLayer = document.getElementById('currentLineLayer');
  const highlightLayer = document.getElementById('highlightLayer');
  const caretMirror = document.getElementById('caretMirror');
  const textarea = document.getElementById('editorTextarea');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const aboutOverlay = document.getElementById('aboutOverlay');
  const fileInput = document.getElementById('fileInput');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalMessage = document.getElementById('modalMessage');
  const modalBox = document.getElementById('modalBox');
  const modalOk = document.getElementById('modalOk');
  const modalCancel = document.getElementById('modalCancel');
  const toast = document.getElementById('toast');
  const searchPanel = document.getElementById('searchPanel') as HTMLElement;
  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  const replaceInput = document.getElementById('replaceInput') as HTMLInputElement;
  const searchMessage = document.getElementById('searchMessage') as HTMLElement;
  let activeSearchMatch: {start: number; end: number; query: string} | null = null;

  // --- display theme ---
  const themeToggle = document.getElementById('themeToggle') as HTMLInputElement;
  const savedTheme = localStorage.getItem('ume-theme');
  const initialTheme = savedTheme === 'light' || savedTheme === 'dark'
    ? savedTheme
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  themeToggle.checked = initialTheme === 'dark';
  if(savedTheme === 'light' || savedTheme === 'dark'){
    document.documentElement.dataset.theme = savedTheme;
  }
  themeToggle.addEventListener('change', ()=>{
    const theme = themeToggle.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ume-theme', theme);
  });

  if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI))
      .catch(error => console.warn('Service worker registration failed:', error));
  }

  // --- custom modal helpers (window.confirm/alert can be silently blocked inside sandboxed pages) ---
  function showConfirm(message, onConfirm, onCancel = ()=>{}, labels: {ok?: string; cancel?: string} = {}){
    modalMessage.textContent = message;
    const previousOkText = modalOk.textContent;
    const previousCancelText = modalCancel.textContent;
    if(labels.ok) modalOk.textContent = labels.ok;
    if(labels.cancel) modalCancel.textContent = labels.cancel;
    modalOverlay.classList.add('show');
    const cleanup = ()=>{
      modalOverlay.classList.remove('show');
      modalOk.removeEventListener('click', okHandler);
      modalCancel.removeEventListener('click', cancelHandler);
      modalOk.textContent = previousOkText;
      modalCancel.textContent = previousCancelText;
    };
    const okHandler = ()=>{ cleanup(); onConfirm(); };
    const cancelHandler = ()=>{ cleanup(); onCancel(); };
    modalOk.addEventListener('click', okHandler);
    modalCancel.addEventListener('click', cancelHandler);
  }

  function showFilenamePrompt(message, initialValue, onSubmit){
    modalMessage.textContent = message;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initialValue;
    input.className = 'modalInput';
    modalBox.classList.add('hasInput');
    input.setAttribute('aria-label', 'ファイル名');
    modalMessage.after(input);
    const previousOkText = modalOk.textContent;
    const previousCancelText = modalCancel.textContent;
    modalOk.textContent = '保存';
    modalCancel.textContent = 'キャンセル';
    modalOverlay.classList.add('show');
    const cleanup = ()=>{
      modalOverlay.classList.remove('show');
      modalOk.removeEventListener('click', okHandler);
      modalCancel.removeEventListener('click', cancelHandler);
      input.removeEventListener('keydown', keyHandler);
      input.remove();
      modalOk.textContent = previousOkText;
      modalCancel.textContent = previousCancelText;
    };
    const okHandler = ()=>{ const name = input.value.trim(); cleanup(); onSubmit(name); };
    const cancelHandler = ()=>cleanup();
    const keyHandler = (event: KeyboardEvent)=>{
      if(event.key === 'Enter'){ event.preventDefault(); okHandler(); }
      if(event.key === 'Escape'){ event.preventDefault(); cancelHandler(); }
    };
    modalOk.addEventListener('click', okHandler);
    modalCancel.addEventListener('click', cancelHandler);
    input.addEventListener('keydown', keyHandler);
    input.focus();
    input.select();
  }
  let toastTimer = null;
  function showToast(message){
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> toast.classList.remove('show'), 2500);
  }

  let fileName = '無題.txt';
  let isDirty = false;
  let saveDirectoryHandle: any = null;
  let documentText = '';
  let documentSelectionStart = 0;
  let documentSelectionEnd = 0;
  let editContext = null;
  let isComposing = false;
  const undoStack: Array<{text: string; selectionStart: number; selectionEnd: number}> = [];

  function updateFileNameDisplay(){
    fileNameDisplay.textContent = fileName + (isDirty ? '*' : '');
  }

  function markDirty(){
    if(isDirty) return;
    isDirty = true;
    updateFileNameDisplay();
  }

  function markSaved(){
    isDirty = false;
    updateFileNameDisplay();
  }

  function recordUndoState(){
    undoStack.push({
      text: documentText,
      selectionStart: documentSelectionStart,
      selectionEnd: documentSelectionEnd
    });
  }

  function undoDocument(){
    const previous = undoStack.pop();
    if(!previous) return;

    markDirty();
    documentText = previous.text;
    textarea.value = documentText;
    documentSelectionStart = previous.selectionStart;
    documentSelectionEnd = previous.selectionEnd;
    textarea.setSelectionRange(documentSelectionStart, documentSelectionEnd);
    if(editContext){
      editContext.updateText(0, editContext.text.length, documentText);
      editContext.updateSelection(documentSelectionStart, documentSelectionEnd);
    }
    fullUpdate();
  }

  function setDocumentText(text){
    undoStack.length = 0;
    textarea.value = text;
    documentText = textarea.value;
    documentSelectionStart = textarea.selectionStart;
    documentSelectionEnd = textarea.selectionEnd;
    if(editContext){
      editContext.updateText(0, editContext.text.length, documentText);
      editContext.updateSelection(documentSelectionStart, documentSelectionEnd);
    }
    markSaved();
  }

  // --- toolbar height sync (keeps layout space reserved for the fixed toolbar) ---
  function syncToolbarHeight(){
    spacer.style.height = toolbar.offsetHeight + 'px';
    document.documentElement.style.setProperty('--toolbar-bottom', toolbar.offsetHeight + 'px');
  }
  new ResizeObserver(syncToolbarHeight).observe(toolbar);
  window.addEventListener('resize', syncToolbarHeight);
  syncToolbarHeight();

  // --- pin toolbar to the true visible top, even when IME/soft keyboard
  //     shifts the visual viewport on mobile (known iOS/Android fixed-position bug) ---
  function pinToolbar(){
    const vv = window.visualViewport;
    const offsetY = (vv ? vv.offsetTop : 0) + (window.scrollY || 0);
    toolbar.style.top = offsetY + 'px';
    searchPanel.style.top = (offsetY + toolbar.offsetHeight) + 'px';
    if(vv){
      toolbar.style.width = vv.width + 'px';
      toolbar.style.left = vv.offsetLeft + 'px';
    }
  }
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', ()=>{
      pinToolbar();
      updateCaretUI();
    });
    window.visualViewport.addEventListener('scroll', ()=>{
      pinToolbar();
      updateCaretUI();
    });
  }
  window.addEventListener('scroll', pinToolbar);
  window.addEventListener('resize', pinToolbar);
  pinToolbar();

  function esc(s){
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // --- heading parse ---
  function headingLevel(line){
    const m = line.match(/^(#{1,6}) (.*)$/);
    return m ? { level: m[1].length, text: m[2] } : null;
  }

  // --- highlight layer (colored heading lines inside editor) ---
  function renderHighlight(){
    if(activeSearchMatch && documentText.slice(activeSearchMatch.start, activeSearchMatch.end) !== activeSearchMatch.query){
      activeSearchMatch = null;
    }
    let documentOffset = 0;
    const lines = documentText.split('\n');
    const html = lines.map(line=>{
      const lineStart = documentOffset;
      documentOffset += line.length + 1;
      const match = activeSearchMatch;
      let content = esc(line);
      if(match && match.end > lineStart && match.start < lineStart + line.length){
        const from = Math.max(0, match.start - lineStart);
        const to = Math.min(line.length, match.end - lineStart);
        content = esc(line.slice(0, from)) + '<span class="searchHit">' + esc(line.slice(from, to)) + '</span>' + esc(line.slice(to));
      }
      const h = headingLevel(line);
      if(h) return '<span class="h' + h.level + '">' + content + '</span>';
      return content === '' ? '\u200b' : content;
    }).join('\n');
    highlightLayer.innerHTML = html;
  }

  function renderedOffsetForDocumentOffset(offset: number){
    const lines = documentText.split('\n');
    let documentPosition = 0;
    let renderedPosition = 0;
    for(let i = 0; i < lines.length; i++){
      const lineLength = lines[i].length;
      if(offset <= documentPosition + lineLength) return renderedPosition + offset - documentPosition;
      documentPosition += lineLength;
      renderedPosition += Math.max(lineLength, 1);
      if(i < lines.length - 1){ documentPosition++; renderedPosition++; }
    }
    return renderedPosition;
  }

  function findRenderedDOMPosition(renderedOffset: number){
    const walker = document.createTreeWalker(highlightLayer, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let traversed = 0;
    while((node = walker.nextNode())){
      const length = node.textContent?.length ?? 0;
      if(renderedOffset <= traversed + length) return {node, offset: renderedOffset - traversed};
      traversed += length;
    }
    return null;
  }

  function scrollToSearchMatch(start: number, end: number){
    const range = document.createRange();
    const rangeStart = findRenderedDOMPosition(renderedOffsetForDocumentOffset(start));
    const rangeEnd = findRenderedDOMPosition(renderedOffsetForDocumentOffset(end));
    if(!rangeStart || !rangeEnd) return;
    range.setStart(rangeStart.node, rangeStart.offset);
    range.setEnd(rangeEnd.node, rangeEnd.offset);
    const rect = range.getBoundingClientRect();
    const wrapperRect = editorWrapper.getBoundingClientRect();
    if(rect.height){
      editorWrapper.scrollTop += rect.top - wrapperRect.top - editorWrapper.clientHeight / 2 + rect.height / 2;
    }
  }

  function searchFrom(direction: 1 | -1){
    const query = searchInput.value;
    if(!query){
      searchMessage.textContent = '';
      activeSearchMatch = null;
      renderHighlight();
      return;
    }
    const current = getEditorSelection();
    let found = -1;
    if(direction > 0){
      const from = activeSearchMatch?.query === query ? activeSearchMatch.end : current.end;
      found = documentText.indexOf(query, from);
      if(found < 0) found = documentText.indexOf(query, 0);
    } else {
      const from = activeSearchMatch?.query === query ? activeSearchMatch.start - 1 : current.start - 1;
      found = documentText.lastIndexOf(query, from);
      if(found < 0) found = documentText.lastIndexOf(query);
    }
    if(found < 0){
      searchMessage.textContent = '検索ワードが見つかりませんでした';
      activeSearchMatch = null;
      renderHighlight();
      return;
    }
    searchMessage.textContent = '';
    activeSearchMatch = {start:found, end:found + query.length, query};
    renderHighlight();
    scrollToSearchMatch(activeSearchMatch.start, activeSearchMatch.end);
  }

  // Convert the browser's DOM caret position in the rendered highlight layer
  // back to a document offset. Empty logical lines render as a single space,
  // so remove that display-only character while mapping the offset.
  function getDocumentOffsetFromPoint(x: number, y: number){
    let node: Node | null = null;
    let nodeOffset = 0;
    const doc = document as any;
    if(typeof doc.caretPositionFromPoint === 'function'){
      const position = doc.caretPositionFromPoint(x, y);
      if(position){ node = position.offsetNode; nodeOffset = position.offset; }
    } else if(typeof doc.caretRangeFromPoint === 'function'){
      const range = doc.caretRangeFromPoint(x, y);
      if(range){ node = range.startContainer; nodeOffset = range.startOffset; }
    }
    if(!node || !highlightLayer.contains(node)) return null;

    const range = document.createRange();
    range.selectNodeContents(highlightLayer);
    range.setEnd(node, nodeOffset);
    return getDocumentOffsetFromRenderedOffset(range.toString().length);
  }

  function getDocumentOffsetFromRenderedOffset(renderedOffset: number){
    const lines = documentText.split('\n');
    let renderedPosition = 0;
    let documentPosition = 0;
    for(let i = 0; i < lines.length; i++){
      const lineLength = lines[i].length;
      const renderedLineLength = Math.max(lineLength, 1);
      if(renderedOffset <= renderedPosition + renderedLineLength){
        return documentPosition + Math.min(renderedOffset - renderedPosition, lineLength);
      }
      renderedPosition += renderedLineLength;
      documentPosition += lineLength;
      if(i < lines.length - 1){
        if(renderedOffset === renderedPosition) return documentPosition;
        if(renderedOffset <= renderedPosition + 1) return documentPosition + 1;
        renderedPosition++;
        documentPosition++;
      }
    }
    return documentText.length;
  }

  function syncDOMSelectionToEditContext(){
    if(!editContext) return;
    const lines = documentText.split('\n');
    function toRenderedOffset(sourceOffset: number){
      const offset = Math.max(0, Math.min(sourceOffset, documentText.length));
      let documentPosition = 0;
      let renderedPosition = 0;
      for(let i = 0; i < lines.length; i++){
        const lineLength = lines[i].length;
        if(offset <= documentPosition + lineLength){
          return renderedPosition + offset - documentPosition;
        }
        documentPosition += lineLength;
        renderedPosition += Math.max(lineLength, 1);
        if(i < lines.length - 1){
          if(offset === documentPosition) return renderedPosition;
          documentPosition++;
          renderedPosition++;
        }
      }
      return renderedPosition;
    }

    function findDOMPosition(renderedOffset: number){
      const walker = document.createTreeWalker(highlightLayer, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      let traversed = 0;
      while((node = walker.nextNode())){
        const length = node.textContent?.length ?? 0;
        if(renderedOffset <= traversed + length){
          return {node, offset: renderedOffset - traversed};
        }
        traversed += length;
      }
      const lastNode = highlightLayer.lastChild;
      if(lastNode?.nodeType === Node.TEXT_NODE){
        return {node:lastNode, offset:lastNode.textContent?.length ?? 0};
      }
      return null;
    }
    const start = findDOMPosition(toRenderedOffset(editContext.selectionStart));
    const end = findDOMPosition(toRenderedOffset(editContext.selectionEnd));
    if(!start || !end) return;

    const selection = document.getSelection();
    if(!selection) return;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // --- outline tree ---
  function renderOutline(){
    const lines = documentText.split('\n');
    const items = [];
    lines.forEach((line, idx)=>{
      const h = headingLevel(line);
      if(h) items.push({level:h.level, text:h.text, lineIndex:idx});
    });
    outlineArea.innerHTML = '';
    if(items.length === 0){
      const empty = document.createElement('div');
      empty.id = 'outlineEmpty';
      empty.textContent = '見出し（# ）がここに表示されます';
      outlineArea.appendChild(empty);
      return;
    }
    items.forEach(item=>{
      const div = document.createElement('div');
      div.className = 'outline-item oh' + item.level;
      const indent = document.createElement('span');
      indent.textContent = ' '.repeat(item.level - 1);
      const marker = document.createElement('span');
      marker.className = 'outline-marker';
      const title = document.createElement('span');
      title.textContent = item.text;
      div.append(indent, marker, title);
      div.addEventListener('click', ()=>{
        jumpToLine(item.lineIndex);
      });
      outlineArea.appendChild(div);
    });
  }

  function jumpToLine(lineIndex){
    const lines = documentText.split('\n');
    let offset = 0;
    for(let i=0;i<lineIndex;i++) offset += lines[i].length + 1;
    const lineEnd = offset + (lines[lineIndex]?.length ?? 0);

    // Put the caret at the end of the heading so Enter starts the next line.
    focusEditorAtSelection(lineEnd, lineEnd);

    // Position the heading's first visual row around the fourth visible row.
    // Measure through the same caret mirror used by the editor layout.
    syncHeights();
    textarea.setSelectionRange(offset, offset);
    const headingTop = measureCaret().top;
    textarea.setSelectionRange(lineEnd, lineEnd);
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 24;
    editorWrapper.scrollTop = Math.max(0, headingTop - lineHeight * 3);
    updateCaretUI();
  }

  // --- caret position / current-line underline / auto-scroll ---
  function measureCaret(){
    const pos = textarea.selectionStart;
    const before = textarea.value.substring(0, pos);
    const after = textarea.value.substring(pos);
    caretMirror.innerHTML = esc(before) + '<span id="caretMarker"> </span>' + esc(after);
    const marker = document.getElementById('caretMarker');
    return { top: marker.offsetTop, height: marker.offsetHeight || 24 };
  }

  function syncHeights(){
    textarea.style.height = 'auto';
    const h = Math.max(textarea.scrollHeight, editorWrapper.clientHeight);
    textarea.style.height = h + 'px';
    highlightLayer.style.height = h + 'px';
    caretMirror.style.height = h + 'px';
  }

  function updateCaretUI(){
    const viewport = window.visualViewport;
    if(viewport){
      // Size the full flex layout to the currently visible viewport. Shrinking
      // only the editor leaves unused space below it when browser chrome moves.
      document.body.style.height = Math.max(0, viewport.offsetTop + viewport.height) + 'px';
    } else {
      document.body.style.removeProperty('height');
    }
    const viewportTop = viewport ? viewport.offsetTop : 0;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    syncHeights();
    const { top, height } = measureCaret();

    // current line underline
    currentLineLayer.innerHTML = '';
    const cur = document.createElement('div');
    cur.className = 'cur';
    cur.style.top = top + 'px';
    cur.style.height = height + 'px';
    currentLineLayer.appendChild(cur);

    // auto-scroll: keep caret line at "second from bottom", not the very bottom
    const wrapperRect = editorWrapper.getBoundingClientRect();
    const visibleTopInset = Math.max(0, viewportTop - wrapperRect.top);
    const visibleBottomInset = Math.max(0, Math.min(editorWrapper.clientHeight, viewportBottom - wrapperRect.top));
    const scrollTop = editorWrapper.scrollTop;
    const caretBottom = top + height;

    if (caretBottom > scrollTop + visibleBottomInset - height) {
      editorWrapper.scrollTop = caretBottom - visibleBottomInset + height;
    }
    if (top < scrollTop + visibleTopInset) {
      editorWrapper.scrollTop = top - visibleTopInset;
    }
  }

  function fullUpdate(){
    renderHighlight();
    renderOutline();
    updateCaretUI();
    if(editContext && !searchPanel.contains(document.activeElement)) syncDOMSelectionToEditContext();
  }

  // --- events ---
  textarea.addEventListener('input', ()=>{
    if(textarea.value !== documentText){
      recordUndoState();
      markDirty();
    }
    documentText = textarea.value;
    documentSelectionStart = textarea.selectionStart;
    documentSelectionEnd = textarea.selectionEnd;
    fullUpdate();
  });
  textarea.addEventListener('click', updateCaretUI);
  textarea.addEventListener('keyup', updateCaretUI);
  textarea.addEventListener('scroll', ()=>{ /* wrapper handles scroll via CSS since textarea overflow hidden */ });
  editorWrapper.addEventListener('scroll', ()=>{
    // keep layers aligned is automatic since they're absolutely positioned within the same scrolling wrapper
  });
  document.addEventListener('selectionchange', ()=>{
    if(document.activeElement === textarea) updateCaretUI();
  });
  window.addEventListener('resize', fullUpdate);

  function initializeEditContext(){
    const EditContextConstructor = (window as any).EditContext;
    if(typeof EditContextConstructor !== 'function' || !('editContext' in HTMLElement.prototype)) return;

    editContext = new EditContextConstructor({
      text: documentText,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd
    });
    documentSelectionStart = editContext.selectionStart;
    documentSelectionEnd = editContext.selectionEnd;

    const editHost = highlightLayer as any;
    editHost.editContext = editContext;
    editHost.tabIndex = 0;
    editHost.style.pointerEvents = 'auto';
    textarea.style.pointerEvents = 'none';

    document.addEventListener('selectionchange', ()=>{
      if(document.activeElement !== editHost) return;
      const selection = document.getSelection();
      if(!selection?.anchorNode || !selection.focusNode ||
         !editHost.contains(selection.anchorNode) || !editHost.contains(selection.focusNode)) return;

      const getRenderedOffset = (node: Node, offset: number)=>{
        const range = document.createRange();
        range.selectNodeContents(editHost);
        range.setEnd(node, offset);
        return range.toString().length;
      };
      const anchor = getDocumentOffsetFromRenderedOffset(
        getRenderedOffset(selection.anchorNode, selection.anchorOffset)
      );
      const focus = getDocumentOffsetFromRenderedOffset(
        getRenderedOffset(selection.focusNode, selection.focusOffset)
      );
      const start = Math.min(anchor, focus);
      let end = Math.max(anchor, focus);
      const renderedSelectionText = selection.toString();
      if(documentText.slice(start, end).includes('\n') && !renderedSelectionText.includes('\n')){
        end = Math.min(end, start + renderedSelectionText.replace(/\u200b/g, '').length);
      }
      const changed = start !== editContext.selectionStart || end !== editContext.selectionEnd;
      if(changed){
        documentSelectionStart = start;
        documentSelectionEnd = end;
        editContext.updateSelection(start, end);
        textarea.setSelectionRange(start, end);
        updateCaretUI();
      }
    });

    editHost.addEventListener('click', (event: MouseEvent)=>{
      const offset = getDocumentOffsetFromPoint(event.clientX, event.clientY);
      if(offset === null) return;
      documentSelectionStart = offset;
      documentSelectionEnd = offset;
      editContext.updateSelection(offset, offset);
      textarea.setSelectionRange(offset, offset);
      updateCaretUI();
    });

    editHost.addEventListener('keydown', (event: KeyboardEvent)=>{
      if(event.key !== 'Enter' || event.isComposing || isComposing) return;
      event.preventDefault();

      const start = Math.min(editContext.selectionStart, editContext.selectionEnd);
      const end = Math.max(editContext.selectionStart, editContext.selectionEnd);
      const newPosition = start + 1;
      recordUndoState();
      markDirty();
      documentText = documentText.slice(0, start) + '\n' + documentText.slice(end);
      editContext.updateText(start, end, '\n');
      editContext.updateSelection(newPosition, newPosition);
      documentSelectionStart = newPosition;
      documentSelectionEnd = newPosition;

      // Keep the legacy textarea's mirror in sync without changing its input path.
      textarea.value = documentText;
      textarea.setSelectionRange(newPosition, newPosition);
      fullUpdate();
    });

    editContext.addEventListener('textupdate', (event: any)=>{
      const start = Math.min(event.updateRangeStart, event.updateRangeEnd);
      const end = Math.max(event.updateRangeStart, event.updateRangeEnd);
      recordUndoState();
      markDirty();
      documentText = documentText.slice(0, start) + event.text + documentText.slice(end);
      documentSelectionStart = event.selectionStart;
      documentSelectionEnd = event.selectionEnd;

      // Keep the legacy textarea's text and collapsed caret mirror in step while
      // the EditContext remains the source of this input update.
      textarea.value = documentText;
      textarea.setSelectionRange(documentSelectionStart, documentSelectionEnd);
      fullUpdate();
    });
    editContext.addEventListener('compositionstart', ()=>{ isComposing = true; });
    editContext.addEventListener('compositionend', ()=>{ isComposing = false; });
  }

  // --- toolbar actions ---
  document.getElementById('btnNew').addEventListener('click', ()=>{
    if(isDirty){
      showConfirm('編集中の内容は破棄されます。新規作成しますか？', ()=>{
        setDocumentText('');
        fileName = '無題.txt';
        updateFileNameDisplay();
        fullUpdate();
      });
    } else {
      setDocumentText('');
      fileName = '無題.txt';
      updateFileNameDisplay();
      fullUpdate();
    }
  });

  document.getElementById('btnOpen').addEventListener('click', ()=>{
    if(isDirty){
      showConfirm('編集中の内容は破棄されます。ファイルを開きますか？', ()=>fileInput.click());
      return;
    }
    fileInput.click();
  });
  fileInput.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev)=>{
      setDocumentText(ev.target.result);
      fileName = file.name;
      updateFileNameDisplay();
      fullUpdate();
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  function incrementExistingDownloadSuffix(name: string){
    const extensionIndex = name.lastIndexOf('.');
    const hasExtension = extensionIndex > 0;
    const baseName = hasExtension ? name.slice(0, extensionIndex) : name;
    const extension = hasExtension ? name.slice(extensionIndex) : '';
    const numberedBase = baseName.match(/^(.*)\((\d+)\)$/);
    if(!numberedBase) return name;
    return numberedBase[1] + '(' + (Number(numberedBase[2]) + 1) + ')' + extension;
  }

  function getNextAvailableVersionName(name: string, existingNames: Set<string>){
    const extensionIndex = name.lastIndexOf('.');
    const hasExtension = extensionIndex > 0;
    const baseName = hasExtension ? name.slice(0, extensionIndex) : name;
    const extension = hasExtension ? name.slice(extensionIndex) : '';
    const numberedBase = baseName.match(/^(.*)\((\d+)\)$/);
    const stem = numberedBase ? numberedBase[1] : baseName;
    let version = numberedBase ? Number(numberedBase[2]) + 1 : 1;
    let candidate = '';
    do{
      candidate = stem + '(' + version + ')' + extension;
      version++;
    }while(existingNames.has(candidate.toLocaleLowerCase()));
    return candidate;
  }

  async function getSaveDirectoryNames(){
    const names = new Set<string>();
    for await (const [name] of saveDirectoryHandle.entries()) names.add(name.toLocaleLowerCase());
    return names;
  }

  async function writeFileToSaveDirectory(name: string){
    const fileHandle = await saveDirectoryHandle.getFileHandle(name, {create:true});
    const writable = await fileHandle.createWritable();
    await writable.write(documentText);
    await writable.close();
    fileName = name;
    markSaved();
  }

  function promptForSaveAsName(initialName: string, message = '保存するファイル名を入力してください'){
    showFilenamePrompt(message, initialName, (name: string)=>{
      if(!name) return;
      void (async()=>{
        const existingNames = await getSaveDirectoryNames();
        if(existingNames.has(name.toLocaleLowerCase())){
          promptForSaveAsName(name, '同じファイル名があります。別のファイル名を入力してください。');
          return;
        }
        await writeFileToSaveDirectory(name);
      })().catch((error: any)=>showToast('保存できませんでした: ' + (error?.message || '')));
    });
  }

  function saveWithBrowserDownload(){
    const blob = new Blob([documentText], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const nextFileName = incrementExistingDownloadSuffix(fileName || '無題.txt');
    a.download = nextFileName;
    fileName = nextFileName;
    markSaved();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function saveDocument(){
    const showDirectoryPicker = (window as any).showDirectoryPicker;
    if(typeof showDirectoryPicker !== 'function'){
      showToast('このブラウザーでは保存先フォルダーを確認できないため、ダウンロードで保存します');
      saveWithBrowserDownload();
      return;
    }

    try{
      if(!saveDirectoryHandle){
        saveDirectoryHandle = await showDirectoryPicker.call(window, {id:'ume-neo-save', mode:'readwrite'});
      }
      const currentName = fileName || '無題.txt';
      const existingNames = await getSaveDirectoryNames();
      if(existingNames.has(currentName.toLocaleLowerCase())){
        showConfirm(
          '同じファイル名があります。バージョンを追加して保存しますか？',
          ()=>{
            void (async()=>{
              const latestNames = await getSaveDirectoryNames();
              const versionName = getNextAvailableVersionName(currentName, latestNames);
              await writeFileToSaveDirectory(versionName);
            })().catch((error: any)=>showToast('保存できませんでした: ' + (error?.message || '')));
          },
          ()=>promptForSaveAsName(currentName),
          {ok:'はい', cancel:'いいえ'}
        );
        return;
      }
      await writeFileToSaveDirectory(currentName);
    }catch(error: any){
      if(error?.name === 'AbortError') return;
      showToast('保存できませんでした: ' + (error?.message || ''));
    }
  }

  document.getElementById('btnSave').addEventListener('click', ()=>{ void saveDocument(); });
  document.getElementById('btnAbout').addEventListener('click', ()=>aboutOverlay.classList.add('show'));
  document.getElementById('aboutClose').addEventListener('click', ()=>aboutOverlay.classList.remove('show'));
  aboutOverlay.addEventListener('click', (event)=>{
    if(event.target === aboutOverlay) aboutOverlay.classList.remove('show');
  });
  document.getElementById('aboutVersion').textContent = packageInfo.version;
  document.addEventListener('keydown', (event: KeyboardEvent)=>{
    if(event.key === 'Escape') aboutOverlay.classList.remove('show');
  });

  document.addEventListener('keydown', (event: KeyboardEvent)=>{
    const editorHasFocus = document.activeElement === textarea || document.activeElement === highlightLayer;
    const modifierPressed = event.ctrlKey || event.metaKey;
    if(modifierPressed && event.key.toLowerCase() === 'f' && (editorHasFocus || searchPanel.contains(document.activeElement))){
      event.preventDefault();
      openSearchPanel();
      return;
    }
    if(!editorHasFocus || !modifierPressed) return;

    const shortcuts: Record<string, string> = {
      s: 'btnSave',
      o: 'btnOpen',
      n: 'btnNew',
      c: 'btnCopy',
      x: 'btnCut',
      v: 'btnPaste'
    };
    const buttonId = shortcuts[event.key.toLowerCase()];
    if(buttonId){
      event.preventDefault();
      (document.getElementById(buttonId) as HTMLButtonElement).click();
      return;
    }

    if(event.key.toLowerCase() === 'z'){
      event.preventDefault();
      undoDocument();
      return;
    }

    if(event.key.toLowerCase() === 'a'){
      event.preventDefault();
      focusEditorAtSelection(0, documentText.length);
    }
  });
  function getEditorSelection(){
    const rawStart = editContext ? editContext.selectionStart : textarea.selectionStart;
    const rawEnd = editContext ? editContext.selectionEnd : textarea.selectionEnd;
    const start = Math.min(rawStart, rawEnd);
    let end = Math.max(rawStart, rawEnd);
    const renderedSelectionText = editContext && document.activeElement === highlightLayer
      ? document.getSelection()?.toString() ?? ''
      : textarea.value.slice(start, end);
    if(documentText.slice(start, end).includes('\n') && !renderedSelectionText.includes('\n')){
      end = Math.min(end, start + renderedSelectionText.replace(/\u200b/g, '').length);
    }
    return {start, end};
  }

  function focusEditorAtSelection(start: number, end: number){
    textarea.setSelectionRange(start, end);
    if(editContext){
      (highlightLayer as HTMLElement).focus({preventScroll:true});
      editContext.updateSelection(start, end);
      documentSelectionStart = start;
      documentSelectionEnd = end;
      syncDOMSelectionToEditContext();
    } else {
      textarea.focus({preventScroll:true});
    }
  }

  function replaceEditorRange(start: number, end: number, replacement: string){
    recordUndoState();
    markDirty();
    const nextText = documentText.slice(0, start) + replacement + documentText.slice(end);
    const nextPosition = start + replacement.length;
    documentText = nextText;
    documentSelectionStart = nextPosition;
    documentSelectionEnd = nextPosition;
    if(editContext){
      editContext.updateText(start, end, replacement);
      editContext.updateSelection(nextPosition, nextPosition);
    }
    textarea.value = nextText;
    textarea.setSelectionRange(nextPosition, nextPosition);
    fullUpdate();
    focusEditorAtSelection(nextPosition, nextPosition);
    updateCaretUI();
  }

  function legacyCopyText(text: string){
    const target = document.createElement('textarea');
    target.value = text;
    target.setAttribute('readonly', '');
    target.setAttribute('aria-hidden', 'true');
    target.style.position = 'fixed';
    target.style.left = '-10000px';
    target.style.top = '0';
    target.style.opacity = '0';
    document.body.appendChild(target);
    target.focus({preventScroll:true});
    target.select();
    let copied = false;
    try{ copied = document.execCommand('copy'); }
    finally{ target.remove(); }
    const selection = getEditorSelection();
    focusEditorAtSelection(selection.start, selection.end);
    return copied;
  }

  document.getElementById('btnCopy').addEventListener('click', ()=>{
    const {start, end} = getEditorSelection();
    const text = start !== end ? documentText.substring(start, end) : documentText;
    // Start clipboard access directly from the tap handler to preserve mobile user activation.
    try{
      if(navigator.clipboard?.writeText){
        void navigator.clipboard.writeText(text).catch(()=>{
          if(!legacyCopyText(text)) showToast('コピーに失敗しました');
        });
      } else if(!legacyCopyText(text)) {
        showToast('コピーに失敗しました');
      }
    }catch{
      if(!legacyCopyText(text)) showToast('コピーに失敗しました');
    }
  });

  document.getElementById('btnCut').addEventListener('click', ()=>{
    const {start, end} = getEditorSelection();
    const text = start !== end ? documentText.substring(start, end) : documentText;
    const removeText = ()=>{
      if(start !== end) replaceEditorRange(start, end, '');
      else replaceEditorRange(0, documentText.length, '');
    };
    const finishCut = (copied: boolean)=>{
      if(!copied){ showToast('カットに失敗しました'); return; }
      removeText();
    };
    try{
      if(navigator.clipboard?.writeText){
        void navigator.clipboard.writeText(text).then(()=>finishCut(true), ()=>finishCut(legacyCopyText(text)));
      } else {
        finishCut(legacyCopyText(text));
      }
    }catch{
      finishCut(legacyCopyText(text));
    }
  });

  document.getElementById('btnPaste').addEventListener('click', ()=>{
    const {start, end} = getEditorSelection();
    const applyPastedText = (text: string)=>replaceEditorRange(start, end, text);
    if(navigator.clipboard?.readText){
      // readText() must be invoked synchronously from the tap handler.
      try{
        void navigator.clipboard.readText().then(applyPastedText, ()=>{
          if(!tryNativePaste()) showToast('ペーストに失敗しました。ブラウザーのクリップボード許可を確認してください');
        });
      }catch{
        if(!tryNativePaste()) showToast('ペーストに失敗しました。ブラウザーのクリップボード許可を確認してください');
      }
      return;
    }
    if(!tryNativePaste()) showToast('この接続ではクリップボードを読み取れません。HTTPSで開くか、本文のブラウザー標準「貼り付け」を使用してください');

    function tryNativePaste(){
      let pasted = false;
      const onPaste = (event: ClipboardEvent)=>{
        const text = event.clipboardData?.getData('text/plain');
        if(text === undefined) return;
        event.preventDefault();
        pasted = true;
        applyPastedText(text);
      };
      document.addEventListener('paste', onPaste, true);
      try{
        if(editContext) (highlightLayer as HTMLElement).focus({preventScroll:true});
        else textarea.focus({preventScroll:true});
        document.execCommand('paste');
      }catch{
        // Some browsers do not expose programmatic paste; the native paste menu remains available.
      }finally{
        document.removeEventListener('paste', onPaste, true);
      }
      return pasted;
    }
  });
  // --- search panel and navigation ---
  function openSearchPanel(){
    searchPanel.hidden = false;
    searchInput.focus();
    searchInput.select();
  }
  document.getElementById('btnSearch').addEventListener('click', openSearchPanel);
  document.getElementById('searchNext').addEventListener('click', ()=>searchFrom(1));
  document.getElementById('searchPrevious').addEventListener('click', ()=>searchFrom(-1));
  document.getElementById('replaceCurrent').addEventListener('click', ()=>{
    if(!activeSearchMatch || documentText.slice(activeSearchMatch.start, activeSearchMatch.end) !== activeSearchMatch.query){
      searchMessage.textContent = '先に検索してください';
      return;
    }
    const replaceCurrentMatch = ()=>{
      const matchStart = activeSearchMatch.start;
      const matchEnd = activeSearchMatch.end;
      replaceEditorRange(matchStart, matchEnd, replaceInput.value);
      activeSearchMatch = null;
      searchInput.focus();
      searchFrom(1);
    };
    if(replaceInput.value === ''){
      showConfirm('置換ワードがありません。削除を強行しますか？', replaceCurrentMatch);
      return;
    }
    replaceCurrentMatch();
  });
  document.getElementById('searchClose').addEventListener('click', ()=>{
    const selection = getEditorSelection();
    searchPanel.hidden = true;
    searchMessage.textContent = '';
    activeSearchMatch = null;
    renderHighlight();

    focusEditorAtSelection(selection.start, selection.end);
  });
  searchInput.addEventListener('input', ()=>{
    searchMessage.textContent = '';
    activeSearchMatch = null;
    renderHighlight();
  });

  // --- font size (16 / 20 / 24px, default 20px) ---
  const fontSizes = [16, 20, 24];
  let fontSizeIndex = 1;
  const btnFontSize = document.getElementById('btnFontSize');
  function applyFontSize(){
    const size = fontSizes[fontSizeIndex];
    document.documentElement.style.setProperty('--editor-font-size', size + 'px');
    btnFontSize.textContent = '文字サイズ: ' + size + 'px';
    fullUpdate();
  }
  btnFontSize.addEventListener('click', ()=>{
    fontSizeIndex = (fontSizeIndex + 1) % fontSizes.length;
    applyFontSize();
  });

  // init
  setDocumentText('# 見出しレベル１\nここに本文を入力してください。\n\n## 見出しレベル２\n本文はエディタ幅で自動的に折り返されます。');
  initializeEditContext();
  fullUpdate();
})();
