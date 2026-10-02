(function(){
  function getRequiredElement(id: string): HTMLElement{
    const element = document.getElementById(id);
    if(!element) throw new Error(`Required element #${id} was not found.`);
    return element;
  }

  interface EditContextLike extends EventTarget{
    text: string;
    selectionStart: number;
    selectionEnd: number;
    updateText(start: number, end: number, text: string): void;
    updateSelection(start: number, end: number): void;
  }

  const toolbar = getRequiredElement('toolbar');
  const spacer = getRequiredElement('spacer');
  const mainArea = getRequiredElement('mainArea');
  const outlineArea = getRequiredElement('outlineArea');
  const outlineToggle = getRequiredElement('btnOutlineToggle') as HTMLButtonElement;
  const editorWrapper = getRequiredElement('editorWrapper');
  const statusLineCount = getRequiredElement('statusLineCount');
  const statusCharacterCount = getRequiredElement('statusCharacterCount');
  const statusCursor = getRequiredElement('statusCursor');
  const statusFileSize = getRequiredElement('statusFileSize');
  const currentLineLayer = getRequiredElement('currentLineLayer');
  const lineNumberLayer = getRequiredElement('lineNumberLayer');
  const highlightLayer = getRequiredElement('highlightLayer');
  const newlineLayer = getRequiredElement('newlineLayer');
  const caretMirror = getRequiredElement('caretMirror');
  const selectionCaret = getRequiredElement('selectionCaret');
  const textarea = getRequiredElement('editorTextarea') as HTMLTextAreaElement;
  const fileNameDisplay = getRequiredElement('fileNameDisplay');
  const helpOverlay = getRequiredElement('helpOverlay');
  const fileInput = getRequiredElement('fileInput') as HTMLInputElement;
  const modalOverlay = getRequiredElement('modalOverlay');
  const modalMessage = getRequiredElement('modalMessage');
  const modalBox = getRequiredElement('modalBox');
  const modalOk = getRequiredElement('modalOk') as HTMLButtonElement;
  const modalCancel = getRequiredElement('modalCancel') as HTMLButtonElement;
  const modalAlt = getRequiredElement('modalAlt') as HTMLButtonElement;
  const toast = getRequiredElement('toast');
  const searchPanel = getRequiredElement('searchPanel');
  const searchInput = getRequiredElement('searchInput') as HTMLInputElement;
  const replaceInput = getRequiredElement('replaceInput') as HTMLInputElement;
  const searchMessage = getRequiredElement('searchMessage');
  const newlineToggle = getRequiredElement('btnNewlineToggle') as HTMLButtonElement;
  const blockModeToggle = getRequiredElement('btnBlockMode') as HTMLButtonElement;
  let showNewlineMarkers = true;
  let activeSearchMatch: {start: number; end: number; query: string} | null = null;
  let chapterModeLevel: 0 | 1 | 2 = 0;
  let activeChapterStart: number | null = null;
  let editorViewRange = {start:0, end:0, contentEnd:0};
  let outlineHeadingElements: HTMLElement[] = [];
  let activeOutlineHeading: HTMLElement | null = null;

  // --- display theme ---
  const themeToggle = getRequiredElement('themeToggle') as HTMLInputElement;
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
  function showConfirm(message: string, onConfirm: ()=>void, onCancel: ()=>void = ()=>{}, labels: {ok?: string; cancel?: string} = {}){
    modalAlt.hidden = true;
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

  function showThreeChoice(message: string, choices: [string, ()=>void, string, ()=>void, string, ()=>void]){
    modalMessage.textContent = message;
    const buttons = [modalOk, modalAlt, modalCancel];
    const previousLabels = buttons.map(button=>button.textContent);
    const handlers = choices.filter((_, index)=>index % 2 === 0).map((_, index)=>()=>{
      const callback = choices[index * 2 + 1] as ()=>void;
      cleanup();
      callback();
    });
    choices.filter((_, index)=>index % 2 === 0).forEach((label, index)=>{
      buttons[index].textContent = label as string;
      buttons[index].hidden = false;
      buttons[index].addEventListener('click', handlers[index]);
    });
    const cleanup = ()=>{
      modalOverlay.classList.remove('show');
      buttons.forEach((button, index)=>{
        button.removeEventListener('click', handlers[index]);
        button.textContent = previousLabels[index];
      });
      modalAlt.hidden = true;
    };
    modalOverlay.classList.add('show');
  }

  function showFilenamePrompt(message: string, initialValue: string, onSubmit: (name: string)=>void){
    modalAlt.hidden = true;
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
    // The prompt can be opened after an awaited file picker / confirmation.
    // Focus it after the modal has been painted so mobile browsers attach the
    // virtual keyboard to the visible input reliably.
    requestAnimationFrame(()=>{
      if(!modalOverlay.classList.contains('show') || !input.isConnected) return;
      input.focus();
      input.select();
    });
  }
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(message: string){
    toast.textContent = message;
    toast.classList.add('show');
    if(toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> toast.classList.remove('show'), 2500);
  }

  let fileName = '無題.txt';
  let isDirty = false;
  let saveDirectoryHandle: any = null;
  let documentText = '';
  let documentSelectionStart = 0;
  let documentSelectionEnd = 0;
  let statsTextSnapshot: string | null = null;
  let documentLineStarts: number[] = [0];
  let documentCharacterCount = 0;
  let documentByteCount = 0;
  let editContext: EditContextLike | null = null;
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

  function refreshStatus(){
    if(statsTextSnapshot !== documentText){
      statsTextSnapshot = documentText;
      documentLineStarts = [0];
      for(let i = 0; i < documentText.length; i++){
        if(documentText.charCodeAt(i) === 10) documentLineStarts.push(i + 1);
      }
      documentCharacterCount = Array.from(documentText).length;
      documentByteCount = new TextEncoder().encode(documentText).length;
    }

    const selection = getEditorSelection();
    const hasSelection = selection.start !== selection.end;
    const position = selection.start;
    let low = 0;
    let high = documentLineStarts.length;
    while(low < high){
      const middle = (low + high) >>> 1;
      if(documentLineStarts[middle] <= position) low = middle + 1;
      else high = middle;
    }
    const lineIndex = Math.max(0, low - 1);
    const column = Array.from(documentText.slice(documentLineStarts[lineIndex], position)).length;

    if(hasSelection){
      let selectionEndLine = findLineIndex(selection.end);
      if(selection.end > selection.start && documentText[selection.end - 1] === '\n') selectionEndLine--;
      const selectionLineCount = Math.max(1, selectionEndLine - findLineIndex(selection.start) + 1);
      const selectionCharacterCount = Array.from(documentText.slice(selection.start, selection.end).replace(/\n/g, '')).length;
      statusLineCount.textContent = '選択行数 ' + selectionLineCount;
      statusCharacterCount.textContent = '選択文字数 ' + selectionCharacterCount;
    } else {
      statusLineCount.textContent = '総行数 ' + documentLineStarts.length;
      statusCharacterCount.textContent = '総文字数 ' + documentCharacterCount;
    }
    statusCursor.textContent = 'カーソル ' + (lineIndex + 1) + ':' + column;
    statusFileSize.textContent = 'サイズ ' + formatFileSize(documentByteCount);
  }

  function findLineIndex(position: number){
    let low = 0;
    let high = documentLineStarts.length;
    while(low < high){
      const middle = (low + high) >>> 1;
      if(documentLineStarts[middle] <= position) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  }

  function formatFileSize(bytes: number){
    if(bytes < 1024) return bytes + ' B';
    if(bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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

  function setDocumentText(text: string){
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
      renderLineNumbers();
    });
    window.visualViewport.addEventListener('scroll', ()=>{
      pinToolbar();
      updateCaretUI();
    });
  }
  window.addEventListener('scroll', pinToolbar);
  window.addEventListener('resize', pinToolbar);
  pinToolbar();

  function esc(s: string){
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderColoredSymbols(s: string){
    return esc(s).replace(/[・●○◎【】『』《》“”]/g, '<span class="symbolRed">$&</span>');
  }

  // --- heading parse ---
  function headingLevel(line: string): {level: number; text: string} | null{
    const m = line.match(/^(#{1,6}) (.*)$/);
    return m ? { level: m[1].length, text: m[2] } : null;
  }

  function getChapterRanges(level: 1 | 2 = 1){
    const lines = documentText.split('\n');
    const chapterHeadings: Array<{lineIndex: number; offset: number; title: string}> = [];
    const sectionHeadings: Array<{lineIndex:number;offset:number;title:string;line:string}> = [];
    let offset = 0;
    lines.forEach((line, lineIndex)=>{
      const heading = headingLevel(line);
      if(heading?.level === 1) chapterHeadings.push({lineIndex, offset, title:heading.text});
      if(heading?.level === 2) sectionHeadings.push({lineIndex, offset, title:heading.text, line});
      offset += line.length + 1;
    });

    const ranges: Array<{
      kind: 'top' | 'chapter' | 'section';
      start: number;
      end: number;
      contentEnd: number;
      lineIndex: number | null;
      title: string;
    }> = [];
    const segments: Array<{kind:'top'|'chapter';start:number;end:number;lineIndex:number|null;title:string}> = [];
    if(chapterHeadings.length === 0){
      segments.push({kind:'top', start:0, end:documentText.length, lineIndex:null, title:'TOP'});
    } else {
      if(chapterHeadings[0].offset > 0){
        segments.push({kind:'top', start:0, end:chapterHeadings[0].offset, lineIndex:null, title:'TOP'});
      }
      chapterHeadings.forEach((heading, index)=>{
        segments.push({kind:'chapter', start:heading.offset, end:chapterHeadings[index + 1]?.offset ?? documentText.length, lineIndex:heading.lineIndex, title:heading.title});
      });
    }
    if(level === 1) return segments.map(segment=>({
      ...segment,
      contentEnd:segment.end < documentText.length && segment.end > segment.start && documentText[segment.end - 1] === '\n' ? segment.end - 1 : segment.end
    }));

    segments.forEach(segment=>{
      const childHeadings = sectionHeadings.filter(item=>item.offset >= segment.start && item.offset < segment.end);
      if(segment.kind === 'top' && segment.start === segment.end) return;
      const firstChild = childHeadings[0];
      if(!firstChild){
        ranges.push({...segment, contentEnd:segment.end < documentText.length && segment.end > segment.start && documentText[segment.end - 1] === '\n' ? segment.end - 1 : segment.end});
        return;
      }
      if(firstChild.offset > segment.start){
        const end = firstChild.offset;
        ranges.push({...segment, end, contentEnd:documentText[end - 1] === '\n' ? end - 1 : end});
      }
      childHeadings.forEach((heading, index)=>{
        const end = childHeadings[index + 1]?.offset ?? segment.end;
        ranges.push({kind:'section', start:heading.offset, end, contentEnd:end < documentText.length && end > heading.offset && documentText[end - 1] === '\n' ? end - 1 : end, lineIndex:heading.lineIndex, title:heading.title});
      });
    });
    return ranges;
  }

  function getChapterRangeAt(position: number, level: 1 | 2 = chapterModeLevel === 2 ? 2 : 1){
    const ranges = getChapterRanges(level);
    return ranges.find((range, index)=>
      position >= range.start && (position < range.end || (index === ranges.length - 1 && position <= range.end))
    ) ?? ranges[ranges.length - 1];
  }

  function getCurrentEditorViewRange(){
    if(chapterModeLevel === 0) return {start:0, end:documentText.length, contentEnd:documentText.length};
    const position = editContext ? editContext.selectionStart : documentSelectionStart;
    const activeRange = activeChapterStart === null
      ? null
      : getChapterRanges(chapterModeLevel).find(range=>range.start === activeChapterStart);
    if(activeRange && position >= activeRange.start &&
       (position < activeRange.end || (position === activeRange.end && activeRange.end === documentText.length))) return activeRange;
    const nextRange = getChapterRangeAt(position);
    activeChapterStart = nextRange.start;
    return nextRange;
  }

  function setTextareaSelectionFromDocument(start: number, end: number){
    const localStart = Math.max(0, Math.min(start - editorViewRange.start, textarea.value.length));
    const localEnd = Math.max(0, Math.min(end - editorViewRange.start, textarea.value.length));
    textarea.setSelectionRange(localStart, localEnd);
  }

  function syncEditorViewRange(){
    const range = getCurrentEditorViewRange();
    const changed = range.start !== editorViewRange.start || range.end !== editorViewRange.end || range.contentEnd !== editorViewRange.contentEnd;
    const chapterChanged = range.start !== editorViewRange.start;
    editorViewRange = range;
    const viewText = documentText.slice(range.start, range.contentEnd);
    if(changed || textarea.value !== viewText){
      textarea.value = viewText;
      setTextareaSelectionFromDocument(documentSelectionStart, documentSelectionEnd);
    }
    if(chapterChanged) editorWrapper.scrollTop = 0;
    return changed;
  }

  function getEditorViewText(){
    return documentText.slice(editorViewRange.start, editorViewRange.contentEnd);
  }

  // --- highlight layer (colored heading lines inside editor) ---
  function renderHighlight(){
    if(activeSearchMatch && documentText.slice(activeSearchMatch.start, activeSearchMatch.end) !== activeSearchMatch.query){
      activeSearchMatch = null;
    }
    let documentOffset = editorViewRange.start;
    const lines = getEditorViewText().split('\n');
    const html = lines.map((line, lineIndex)=>{
      const lineStart = documentOffset;
      documentOffset += line.length + 1;
      const match = activeSearchMatch;
      let content = renderColoredSymbols(line);
      if(match && match.end > lineStart && match.start < lineStart + line.length){
        const from = Math.max(0, match.start - lineStart);
        const to = Math.min(line.length, match.end - lineStart);
        content = renderColoredSymbols(line.slice(0, from)) + '<span class="searchHit">' + renderColoredSymbols(line.slice(from, to)) + '</span>' + renderColoredSymbols(line.slice(to));
      }
      const h = headingLevel(line);
      if(content === '') content = '\u200b';
      if(h) content = '<span class="h' + h.level + '">' + content + '</span>';
      return '<span class="editorLogicalLine" data-editor-line="' + lineIndex + '">' + content + '</span>';
    }).join('\n');
    highlightLayer.innerHTML = html;
    if(showNewlineMarkers) renderNewlineMarkers();
  }

  function renderNewlineMarkers(){
    newlineLayer.replaceChildren();
    const lines = highlightLayer.querySelectorAll('.editorLogicalLine');
    const layerRect = highlightLayer.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(highlightLayer).lineHeight) || 0;
    lines.forEach((line, index)=>{
      if(index >= lines.length - 1) return;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let lastText: Node | null = null;
      while(walker.nextNode()) lastText = walker.currentNode;
      if(!lastText) return;
      const range = document.createRange();
      const length = lastText.textContent?.length ?? 0;
      if(length > 0){
        range.setStart(lastText, length - 1);
        range.setEnd(lastText, length);
      } else {
        range.selectNodeContents(line);
        range.collapse(false);
      }
      let rect = range.getBoundingClientRect();
      if(!rect.height){
        const lineRects = line.getClientRects();
        rect = lineRects.item(lineRects.length - 1) ?? line.getBoundingClientRect();
      }
      const marker = document.createElement('span');
      marker.className = 'newlineMarker';
      marker.textContent = '↲';
      marker.style.left = (rect.right - layerRect.left + 2) + 'px';
      const rowRects = line.getClientRects();
      const rowRect = rowRects.item(rowRects.length - 1) ?? rect;
      marker.style.top = (rowRect.top + (rowRect.height - lineHeight) / 2 - layerRect.top) + 'px';
      newlineLayer.appendChild(marker);
    });
  }

  function renderedOffsetForDocumentOffset(offset: number){
    const lines = getEditorViewText().split('\n');
    let documentPosition = editorViewRange.start;
    let renderedPosition = 0;
    for(let i = 0; i < lines.length; i++){
      const lineLength = lines[i].length;
      if(offset <= documentPosition + lineLength) return renderedPosition + Math.max(0, Math.min(offset - documentPosition, lineLength));
      documentPosition += lineLength;
      renderedPosition += Math.max(lineLength, 1);
      if(i < lines.length - 1){ documentPosition++; renderedPosition++; }
    }
    return renderedPosition;
  }

  function findRenderedDOMPosition(renderedOffset: number, preferNext = false){
    const walker = document.createTreeWalker(highlightLayer, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let traversed = 0;
    while((node = walker.nextNode())){
      const length = node.textContent?.length ?? 0;
      if(preferNext ? renderedOffset < traversed + length : renderedOffset <= traversed + length){
        return {node, offset: renderedOffset - traversed};
      }
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
    documentSelectionStart = found;
    documentSelectionEnd = found;
    if(editContext) editContext.updateSelection(found, found);
    syncEditorViewRange();
    setTextareaSelectionFromDocument(found, found);
    renderHighlight();
    if(editContext && document.activeElement === highlightLayer) syncDOMSelectionToEditContext();
    updateCaretUI();
    scrollToSearchMatch(activeSearchMatch.start, activeSearchMatch.end);
  }

  // Convert the browser's DOM caret position in the rendered highlight layer
  // back to a document offset. Empty logical lines render as a single space,
  // so map that display-only character without adding a document character.
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
    const viewText = getEditorViewText();
    const lines = viewText.split('\n');
    let renderedPosition = 0;
    let documentPosition = 0;
    for(let i = 0; i < lines.length; i++){
      const lineLength = lines[i].length;
      const renderedLineLength = Math.max(lineLength, 1);
      if(renderedOffset <= renderedPosition + renderedLineLength){
        return editorViewRange.start + documentPosition + Math.min(renderedOffset - renderedPosition, lineLength);
      }
      renderedPosition += renderedLineLength;
      documentPosition += lineLength;
      if(i < lines.length - 1){
        if(renderedOffset === renderedPosition) return editorViewRange.start + documentPosition;
        if(renderedOffset <= renderedPosition + 1) return editorViewRange.start + documentPosition + 1;
        renderedPosition++;
        documentPosition++;
      }
    }
    return editorViewRange.start + viewText.length;
  }

  function syncDOMSelectionToEditContext(){
    if(!editContext) return;
    const viewText = getEditorViewText();
    const lines = viewText.split('\n');
    function toRenderedOffset(sourceOffset: number){
      const offset = Math.max(0, Math.min(sourceOffset - editorViewRange.start, viewText.length));
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
      let lastTextNode: Node | null = null;
      let traversed = 0;
      while((node = walker.nextNode())){
        lastTextNode = node;
        const length = node.textContent?.length ?? 0;
        if(renderedOffset < traversed + length){
          return {node, offset: renderedOffset - traversed};
        }
        traversed += length;
      }
      if(lastTextNode){
        return {node:lastTextNode, offset:lastTextNode.textContent?.length ?? 0};
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
    const items: Array<{level: number; text: string; lineIndex: number; offset: number}> = [];
    let offset = 0;
    lines.forEach((line, idx)=>{
      const h = headingLevel(line);
      if(h) items.push({level:h.level, text:h.text, lineIndex:idx, offset});
      offset += line.length + 1;
    });
    outlineArea.innerHTML = '';
    outlineHeadingElements = [];
    activeOutlineHeading = null;
    const topRange = getChapterRanges().find(range=>range.kind === 'top');
    if(topRange){
      const topItem = document.createElement('div');
      topItem.className = 'outline-item outline-top';
      topItem.dataset.documentOffset = '0';
      const marker = document.createElement('span');
      marker.className = 'outline-marker outline-top-marker';
      const title = document.createElement('span');
      title.textContent = 'TOP';
      topItem.append(marker, title);
      topItem.addEventListener('click', ()=>{
        focusEditorAtSelection(0, 0);
        editorWrapper.scrollTop = 0;
        updateCaretUI();
      });
      outlineArea.appendChild(topItem);
      outlineHeadingElements.push(topItem);
    }
    if(items.length === 0 && !topRange){
      const empty = document.createElement('div');
      empty.id = 'outlineEmpty';
      empty.textContent = '見出し（# ）がここに表示されます';
      outlineArea.appendChild(empty);
      return;
    }
    items.forEach(item=>{
      const div = document.createElement('div');
      div.className = 'outline-item oh' + item.level;
      div.dataset.documentOffset = String(item.offset);
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
      outlineHeadingElements.push(div);
    });
  }

  function updateActiveOutlineHeading(documentOffset: number){
    let low = 0;
    let high = outlineHeadingElements.length - 1;
    let activeIndex = -1;
    while(low <= high){
      const middle = (low + high) >> 1;
      const headingOffset = Number(outlineHeadingElements[middle].dataset.documentOffset);
      if(headingOffset <= documentOffset){
        activeIndex = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const nextActive = activeIndex >= 0 ? outlineHeadingElements[activeIndex] : null;
    if(nextActive === activeOutlineHeading) return;
    activeOutlineHeading?.classList.remove('outline-item-active');
    activeOutlineHeading = nextActive;
    activeOutlineHeading?.classList.add('outline-item-active');
  }

  function jumpToLine(lineIndex: number){
    const lines = documentText.split('\n');
    let offset = 0;
    for(let i=0;i<lineIndex;i++) offset += lines[i].length + 1;
    const lineEnd = offset + (lines[lineIndex]?.length ?? 0);

    // Put the caret at the end of the heading so Enter starts the next line.
    focusEditorAtSelection(lineEnd, lineEnd);

    // Position the heading's first visual row around the fourth visible row.
    // Measure through the same caret mirror used by the editor layout.
    syncHeights();
    setTextareaSelectionFromDocument(offset, offset);
    const headingTop = measureCaret(offset).top;
    setTextareaSelectionFromDocument(lineEnd, lineEnd);
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 24;
    editorWrapper.scrollTop = Math.max(0, headingTop - lineHeight * 3);
    updateCaretUI();
  }

  // --- caret position / current-line underline / auto-scroll ---
  function measureCaret(position?: number){
    let documentPosition = position ?? (editContext ? editContext.selectionStart : editorViewRange.start + textarea.selectionStart);
    const editorFocused = document.activeElement === textarea || document.activeElement === highlightLayer;
    let hasSelection = position === undefined && editorFocused && getEditorSelection().start !== getEditorSelection().end;
    if(position === undefined && editContext && document.activeElement === highlightLayer){
      const selection = document.getSelection();
      if(selection?.focusNode && highlightLayer.contains(selection.focusNode)){
        const range = document.createRange();
        range.selectNodeContents(highlightLayer);
        range.setEnd(selection.focusNode, selection.focusOffset);
        documentPosition = getDocumentOffsetFromRenderedOffset(range.toString().length);
        hasSelection = !selection.isCollapsed;
      } else {
        documentPosition = editContext.selectionEnd;
        hasSelection = editContext.selectionStart !== editContext.selectionEnd;
      }
    } else if(position === undefined && hasSelection && textarea.selectionDirection === 'backward'){
      documentPosition = editorViewRange.start + textarea.selectionStart;
    } else if(position === undefined && hasSelection){
      documentPosition = editorViewRange.start + textarea.selectionEnd;
    }
    const localPosition = Math.max(0, Math.min(documentPosition - editorViewRange.start, textarea.value.length));
    const before = textarea.value.substring(0, localPosition);
    const after = textarea.value.substring(localPosition);
    caretMirror.innerHTML = esc(before) + '<span id="caretMarker"> </span>' + esc(after);
    const marker = getRequiredElement('caretMarker');
    return { top: marker.offsetTop, left: marker.offsetLeft, height: marker.offsetHeight || 24, hasSelection, documentOffset: documentPosition };
  }

  function measureVisualRowTop(position: number){
    const renderedOffset = renderedOffsetForDocumentOffset(position);
    const domPosition = findRenderedDOMPosition(renderedOffset, true);
    if(!domPosition) return null;

    // Measure a real glyph in #highlightLayer instead of inferring the row
    // from a mirror character. At the start of a soft-wrapped row, the glyph
    // at the caret offset belongs to the new row even when its X coordinate is 0.
    const nodeText = domPosition.node.textContent ?? '';
    let start = domPosition.offset;
    let end = start + 1;
    if(nodeText[start] === '\n'){
      if(start === 0) return null;
      start--;
      end--;
    }
    if(start < 0 || end > nodeText.length) return null;

    const range = document.createRange();
    range.setStart(domPosition.node, start);
    range.setEnd(domPosition.node, end);
    const rect = range.getBoundingClientRect();
    if(!rect.height) return null;
    return rect.top - highlightLayer.getBoundingClientRect().top;
  }

  function syncHeights(){
    textarea.style.height = 'auto';
    const h = Math.max(textarea.scrollHeight, editorWrapper.clientHeight);
    textarea.style.height = h + 'px';
    highlightLayer.style.height = h + 'px';
    newlineLayer.style.height = h + 'px';
    caretMirror.style.height = h + 'px';
    lineNumberLayer.style.height = h + 'px';
    renderLineNumbers();
  }

  function renderLineNumbers(){
    const lineElements = highlightLayer.querySelectorAll('.editorLogicalLine');
    const layerRect = highlightLayer.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(highlightLayer).lineHeight) || 0;
    const fragment = document.createDocumentFragment();
    const baseLineNumber = findLineIndex(editorViewRange.start);
    lineElements.forEach((line, index)=>{
      const firstRow = line.getClientRects()[0];
      if(!firstRow) return;
      const number = document.createElement('div');
      number.className = 'lineNumber';
      number.textContent = String(baseLineNumber + index + 1).slice(-3).padStart(3, '0');
      number.style.top = (firstRow.top + (firstRow.height - lineHeight) / 2 - layerRect.top) + 'px';
      fragment.appendChild(number);
    });
    lineNumberLayer.replaceChildren(fragment);
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
    const { top, left, height, hasSelection, documentOffset } = measureCaret();
    const visualRowTop = measureVisualRowTop(documentOffset) ?? top;
    refreshStatus();
    updateActiveOutlineHeading(documentOffset);
    selectionCaret.style.display = hasSelection ? 'block' : 'none';
    selectionCaret.style.top = top + 'px';
    selectionCaret.style.left = left + 'px';
    selectionCaret.style.height = height + 'px';
    if(editContext && document.activeElement === highlightLayer){
      highlightLayer.style.caretColor = hasSelection ? 'transparent' : '';
    } else {
      textarea.style.caretColor = hasSelection ? 'transparent' : '';
    }

    // current line underline
    currentLineLayer.innerHTML = '';
    const cur = document.createElement('div');
    cur.className = 'cur';
    cur.style.top = visualRowTop + 'px';
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
    syncEditorViewRange();
    renderHighlight();
    renderOutline();
    // Reapply the DOM selection only while the EditContext host owns focus.
    // Updating it while a dialog or another input is active can steal focus
    // back from that control (notably the Save As filename field).
    if(editContext && document.activeElement === highlightLayer) syncDOMSelectionToEditContext();
    updateCaretUI();
    renderLineNumbers();
  }

  function updateLegacySelection(){
    documentSelectionStart = editorViewRange.start + textarea.selectionStart;
    documentSelectionEnd = editorViewRange.start + textarea.selectionEnd;
    if(chapterModeLevel !== 0 && getCurrentEditorViewRange().start !== editorViewRange.start) fullUpdate();
    else updateCaretUI();
  }

  // --- events ---
  textarea.addEventListener('input', ()=>{
    const nextText = documentText.slice(0, editorViewRange.start) + textarea.value + documentText.slice(editorViewRange.contentEnd);
    if(nextText !== documentText){
      recordUndoState();
      markDirty();
    }
    documentText = nextText;
    documentSelectionStart = editorViewRange.start + textarea.selectionStart;
    documentSelectionEnd = editorViewRange.start + textarea.selectionEnd;
    fullUpdate();
  });
  textarea.addEventListener('click', updateLegacySelection);
  textarea.addEventListener('keyup', updateLegacySelection);
  textarea.addEventListener('scroll', ()=>{ /* wrapper handles scroll via CSS since textarea overflow hidden */ });
  editorWrapper.addEventListener('scroll', ()=>{
    // keep layers aligned is automatic since they're absolutely positioned within the same scrolling wrapper
  });
  document.addEventListener('selectionchange', ()=>{
    if(document.activeElement === textarea) updateLegacySelection();
  });
  window.addEventListener('resize', fullUpdate);

  function initializeEditContext(){
    const EditContextConstructor = (window as any).EditContext;
    if(typeof EditContextConstructor !== 'function' || !('editContext' in HTMLElement.prototype)) return;

    const context = new EditContextConstructor({
      text: documentText,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd
    }) as EditContextLike;
    editContext = context;
    documentSelectionStart = context.selectionStart;
    documentSelectionEnd = context.selectionEnd;

    const editHost = highlightLayer as any;
    editHost.editContext = context;
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
      const changed = start !== context.selectionStart || end !== context.selectionEnd;
      if(changed){
        documentSelectionStart = start;
        documentSelectionEnd = end;
        context.updateSelection(start, end);
        setTextareaSelectionFromDocument(start, end);
        const previousRangeStart = editorViewRange.start;
        if(chapterModeLevel !== 0 && getCurrentEditorViewRange().start !== previousRangeStart) fullUpdate();
        else updateCaretUI();
      }
    });

    editHost.addEventListener('click', (event: MouseEvent)=>{
      const offset = getDocumentOffsetFromPoint(event.clientX, event.clientY);
      if(offset === null) return;
      documentSelectionStart = offset;
      documentSelectionEnd = offset;
      context.updateSelection(offset, offset);
      setTextareaSelectionFromDocument(offset, offset);
      updateCaretUI();
    });

    editHost.addEventListener('keydown', (event: KeyboardEvent)=>{
      if(chapterModeLevel !== 0){
        const selectionStart = Math.min(context.selectionStart, context.selectionEnd);
        const selectionEnd = Math.max(context.selectionStart, context.selectionEnd);
        if((event.ctrlKey || event.metaKey) && (event.key === 'Home' || event.key === 'End')){
          event.preventDefault();
          const destination = event.key === 'Home' ? editorViewRange.start : editorViewRange.contentEnd;
          documentSelectionStart = destination;
          documentSelectionEnd = destination;
          context.updateSelection(destination, destination);
          setTextareaSelectionFromDocument(destination, destination);
          syncDOMSelectionToEditContext();
          updateCaretUI();
          return;
        }
        if((event.key === 'ArrowLeft' && selectionStart <= editorViewRange.start) ||
           (event.key === 'ArrowRight' && selectionEnd >= editorViewRange.contentEnd) ||
           (event.key === 'Backspace' && selectionStart === selectionEnd && selectionStart <= editorViewRange.start) ||
           (event.key === 'Delete' && selectionStart === selectionEnd && selectionEnd >= editorViewRange.contentEnd)){
          event.preventDefault();
          return;
        }
      }
      if(event.key === 'ArrowLeft' && event.shiftKey && !event.isComposing && !isComposing){
        const selection = document.getSelection();
        if(!selection) return;
        const focusNode = selection?.focusNode;
        const emptyLine = focusNode?.previousSibling;
        const previousSeparator = emptyLine?.previousSibling;
        if(focusNode?.nodeType === Node.TEXT_NODE && focusNode.textContent === '\n' &&
           selection.focusOffset === 0 && emptyLine?.nodeType === Node.ELEMENT_NODE &&
           (emptyLine as HTMLElement).classList.contains('editorLogicalLine') &&
           emptyLine.textContent === '\u200b' && previousSeparator?.nodeType === Node.TEXT_NODE &&
           previousSeparator.textContent === '\n' && selection.anchorNode){
          const anchorNode = selection.anchorNode;
          const anchorOffset = selection.anchorOffset;
          event.preventDefault();
          selection.setBaseAndExtent(anchorNode, anchorOffset, previousSeparator, 0);
          const toDocumentOffset = (node: Node, offset: number)=>{
            const range = document.createRange();
            range.selectNodeContents(editHost);
            range.setEnd(node, offset);
            return getDocumentOffsetFromRenderedOffset(range.toString().length);
          };
          const anchor = toDocumentOffset(anchorNode, anchorOffset);
          const focus = toDocumentOffset(previousSeparator, 0);
          const start = Math.min(anchor, focus);
          const end = Math.max(anchor, focus);
          documentSelectionStart = start;
          documentSelectionEnd = end;
          context.updateSelection(start, end);
          setTextareaSelectionFromDocument(start, end);
          updateCaretUI();
          return;
        }
      }
      if(event.key === 'ArrowRight' && event.shiftKey && !event.isComposing && !isComposing){
        const selection = document.getSelection();
        if(!selection) return;
        const focusNode = selection?.focusNode;
        const focusLine = focusNode?.parentElement;
        const focusLineSeparator = focusLine?.nextSibling;
        if(selection?.isCollapsed && focusNode?.nodeType === Node.TEXT_NODE &&
           focusNode.textContent === '\u200b' && selection.focusOffset === 0 &&
           focusLine?.classList.contains('editorLogicalLine') &&
           focusLine.textContent === '\u200b' && focusLineSeparator?.nodeType === Node.TEXT_NODE &&
           focusLineSeparator.textContent === '\n'){
          const toDocumentOffset = (node: Node, offset: number)=>{
            const range = document.createRange();
            range.selectNodeContents(editHost);
            range.setEnd(node, offset);
            return getDocumentOffsetFromRenderedOffset(range.toString().length);
          };
          event.preventDefault();
          selection.setBaseAndExtent(focusNode, 0, focusLineSeparator, 1);
          const start = toDocumentOffset(focusNode, 0);
          const end = toDocumentOffset(focusLineSeparator, 1);
          documentSelectionStart = Math.min(start, end);
          documentSelectionEnd = Math.max(start, end);
          context.updateSelection(documentSelectionStart, documentSelectionEnd);
          setTextareaSelectionFromDocument(documentSelectionStart, documentSelectionEnd);
          updateCaretUI();
          return;
        }
        const emptyLine = focusNode?.nextSibling;
        const nextSeparator = emptyLine?.nextSibling;
        if(focusNode?.nodeType === Node.TEXT_NODE && focusNode.textContent === '\n' &&
           selection.focusOffset === 1 && emptyLine?.nodeType === Node.ELEMENT_NODE &&
           (emptyLine as HTMLElement).classList.contains('editorLogicalLine') &&
           emptyLine.textContent === '\u200b' && nextSeparator?.nodeType === Node.TEXT_NODE &&
           nextSeparator.textContent === '\n' && selection.anchorNode){
          const anchorNode = selection.anchorNode;
          const anchorOffset = selection.anchorOffset;
          const toDocumentOffset = (node: Node, offset: number)=>{
            const range = document.createRange();
            range.selectNodeContents(editHost);
            range.setEnd(node, offset);
            return getDocumentOffsetFromRenderedOffset(range.toString().length);
          };
          const anchor = toDocumentOffset(anchorNode, anchorOffset);
          const focus = toDocumentOffset(focusNode, selection.focusOffset);
          if(anchor <= focus){
            event.preventDefault();
            selection.setBaseAndExtent(anchorNode, anchorOffset, nextSeparator, 1);
            const nextFocus = toDocumentOffset(nextSeparator, 1);
            const start = Math.min(anchor, nextFocus);
            const end = Math.max(anchor, nextFocus);
            documentSelectionStart = start;
            documentSelectionEnd = end;
            context.updateSelection(start, end);
            setTextareaSelectionFromDocument(start, end);
            updateCaretUI();
            return;
          }
        }
      }
      if(event.key === 'ArrowRight' && event.shiftKey && !event.isComposing && !isComposing &&
         context.selectionStart === context.selectionEnd &&
         documentText[context.selectionEnd] === '\n'){
        const start = context.selectionEnd;
        const nextCodePoint = documentText.codePointAt(start + 1);
        if(nextCodePoint === undefined || nextCodePoint === 10) return;
        event.preventDefault();
        const nextPosition = start + 1 + (nextCodePoint > 0xffff ? 2 : 1);
        documentSelectionStart = start;
        documentSelectionEnd = nextPosition;
        context.updateSelection(start, nextPosition);
        setTextareaSelectionFromDocument(start, nextPosition);
        syncDOMSelectionToEditContext();
        updateCaretUI();
        return;
      }
      if(event.key === 'ArrowDown' && event.shiftKey && !event.isComposing && !isComposing){
        const selection = document.getSelection();
        if(!selection) return;
        if(selection?.focusNode && editHost.contains(selection.focusNode)){
          const range = document.createRange();
          range.selectNodeContents(editHost);
          range.setEnd(selection.focusNode, selection.focusOffset);
          const focusOffset = getDocumentOffsetFromRenderedOffset(range.toString().length);
          if(focusOffset === documentText.length){
            event.preventDefault();
            return;
          }
        }
      }
      if(event.key !== 'Enter' || event.isComposing || isComposing) return;
      event.preventDefault();

      const start = Math.min(context.selectionStart, context.selectionEnd);
      const end = Math.max(context.selectionStart, context.selectionEnd);
      const newPosition = start + 1;
      recordUndoState();
      markDirty();
      documentText = documentText.slice(0, start) + '\n' + documentText.slice(end);
      context.updateText(start, end, '\n');
      context.updateSelection(newPosition, newPosition);
      documentSelectionStart = newPosition;
      documentSelectionEnd = newPosition;

      // Keep the legacy textarea's mirror in sync without changing its input path.
      textarea.value = getEditorViewText();
      setTextareaSelectionFromDocument(newPosition, newPosition);
      fullUpdate();
    });

    context.addEventListener('textupdate', (event: any)=>{
      const start = Math.min(event.updateRangeStart, event.updateRangeEnd);
      const end = Math.max(event.updateRangeStart, event.updateRangeEnd);
      recordUndoState();
      markDirty();
      documentText = documentText.slice(0, start) + event.text + documentText.slice(end);
      documentSelectionStart = event.selectionStart;
      documentSelectionEnd = event.selectionEnd;
      context.updateSelection(documentSelectionStart, documentSelectionEnd);

      // Keep the legacy textarea's text and collapsed caret mirror in step while
      // the EditContext remains the source of this input update.
      textarea.value = getEditorViewText();
      setTextareaSelectionFromDocument(documentSelectionStart, documentSelectionEnd);
      fullUpdate();
    });
    context.addEventListener('compositionstart', ()=>{ isComposing = true; });
    context.addEventListener('compositionend', ()=>{ isComposing = false; });
  }

  // --- toolbar actions ---
  getRequiredElement('btnNew').addEventListener('click', ()=>{
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

  getRequiredElement('btnOpen').addEventListener('click', ()=>{
    if(isDirty){
      showConfirm('編集中の内容は破棄されます。ファイルを開きますか？', ()=>fileInput.click());
      return;
    }
    fileInput.click();
  });
  fileInput.addEventListener('change', (e)=>{
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev)=>{
      if(typeof ev.target?.result !== 'string') return;
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

  async function getSaveDirectoryNames(directory: any = saveDirectoryHandle){
    const names = new Set<string>();
    for await (const [name] of directory.entries()) names.add(name.toLocaleLowerCase());
    return names;
  }

  async function writeFileToSaveDirectory(name: string, directory: any = saveDirectoryHandle){
    const fileHandle = await directory.getFileHandle(name, {create:true});
    const writable = await fileHandle.createWritable();
    await writable.write(documentText);
    await writable.close();
    saveDirectoryHandle = directory;
    fileName = name;
    markSaved();
  }

  function promptForSaveAsName(initialName: string, directory: any = saveDirectoryHandle, message = '\u4fdd\u5b58\u3059\u308b\u30d5\u30a1\u30a4\u30eb\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044'){
    showFilenamePrompt(message, initialName, (name: string)=>{
      if(!name) return;
      void (async()=>{
        const existingNames = await getSaveDirectoryNames(directory);
        if(existingNames.has(name.toLocaleLowerCase())){
          showThreeChoice('\u300c' + name + '\u300d\u306f\u65e2\u306b\u3042\u308a\u307e\u3059\u3002\u3069\u3046\u3057\u307e\u3059\u304b\uff1f', [
            '\u4e0a\u66f8\u304d', ()=>void writeNamedFile(name, directory),
            '\u5225\u540d\u3067\u4fdd\u5b58', ()=>void saveAsInNewDirectory(name),
            '\u30ad\u30e3\u30f3\u30bb\u30eb', ()=>{}
          ]);
          return;
        }
        await writeNamedFile(name, directory);
      })().catch((error: any)=>showToast('\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f: ' + (error?.message || '')));
    });
  }

  async function writeNumberedVersion(name: string, directory: any = saveDirectoryHandle){
    const latestNames = await getSaveDirectoryNames(directory);
    await writeFileToSaveDirectory(getNextAvailableVersionName(name, latestNames), directory);
  }

  async function writeNamedFile(name: string, directory: any = saveDirectoryHandle){
    try{
      await writeFileToSaveDirectory(name, directory);
    }catch(error: any){
      const detail = error?.message ? '\n' + error.message : '';
      showThreeChoice('\u4e0a\u66f8\u304d\u4fdd\u5b58\u304c\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002' + detail + '\n\u4fdd\u5b58\u65b9\u6cd5\u3092\u9078\u3093\u3067\u304f\u3060\u3055\u3044\u3002', [
        '\u6570\u5b57\u3092\u4ed8\u3051\u3066\u4fdd\u5b58', ()=>void writeNumberedVersion(name, directory).catch((e: any)=>showToast('\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f: ' + (e?.message || ''))),
        '\u5225\u540d\u3067\u4fdd\u5b58', ()=>void saveAsInNewDirectory(name),
        '\u30ad\u30e3\u30f3\u30bb\u30eb', ()=>{}
      ]);
    }
  }

  async function saveAsInNewDirectory(initialName: string){
    const picker = (window as any).showDirectoryPicker;
    if(typeof picker !== 'function'){
      showToast('\u3053\u306e\u30d6\u30e9\u30a6\u30b6\u30fc\u3067\u306f\u4fdd\u5b58\u5148\u30d5\u30a9\u30eb\u30c0\u30fc\u3092\u9078\u3079\u306a\u3044\u305f\u3081\u3001\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9\u3067\u4fdd\u5b58\u3057\u307e\u3059');
      saveWithBrowserDownload();
      return;
    }
    try{
      const directory = await picker.call(window, {id:'ume-neo-save-as', mode:'readwrite'});
      promptForSaveAsName(initialName, directory);
    }catch(error: any){
      if(error?.name !== 'AbortError') showToast('\u4fdd\u5b58\u5148\u30d5\u30a9\u30eb\u30c0\u30fc\u3092\u958b\u3051\u307e\u305b\u3093\u3067\u3057\u305f: ' + (error?.message || ''));
    }
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
      const currentName = fileName || '\u7121\u984c.txt';
      const existingNames = await getSaveDirectoryNames();
      if(existingNames.has(currentName.toLocaleLowerCase())){
        showThreeChoice('\u300c' + currentName + '\u300d\u306f\u65e2\u306b\u3042\u308a\u307e\u3059\u3002\u3069\u3046\u3057\u307e\u3059\u304b\uff1f', [
          '\u4e0a\u66f8\u304d', ()=>void writeNamedFile(currentName),
          '\u5225\u540d\u3067\u4fdd\u5b58', ()=>void saveAsInNewDirectory(currentName),
          '\u30ad\u30e3\u30f3\u30bb\u30eb', ()=>{}
        ]);
        return;
      }
      await writeNamedFile(currentName);
    }catch(error: any){
      if(error?.name === 'AbortError') return;
      showToast('保存できませんでした: ' + (error?.message || ''));
    }
  }

  function showSaveOptions(){
    showThreeChoice('\u4fdd\u5b58\u65b9\u6cd5\u3092\u9078\u3093\u3067\u304f\u3060\u3055\u3044', [
      '\u4e0a\u66f8\u304d\u4fdd\u5b58', ()=>void saveDocument(),
      '\u5225\u540d\u3067\u4fdd\u5b58', ()=>void saveAsInNewDirectory(fileName || '\u7121\u984c.txt'),
      '\u30ad\u30e3\u30f3\u30bb\u30eb', ()=>{}
    ]);
  }

  outlineToggle.addEventListener('click', ()=>{
    const isVisible = mainArea.classList.contains('sidebar-hidden');
    mainArea.classList.toggle('sidebar-hidden', !isVisible);
    outlineArea.setAttribute('aria-hidden', String(!isVisible));
    outlineToggle.setAttribute('aria-pressed', String(isVisible));
    outlineToggle.setAttribute('aria-label', isVisible
      ? '\u76ee\u6b21\u3092\u975e\u8868\u793a'
      : '\u76ee\u6b21\u3092\u8868\u793a');
    outlineToggle.title = isVisible
      ? '\u76ee\u6b21\u3092\u975e\u8868\u793a'
      : '\u76ee\u6b21\u3092\u8868\u793a';
    outlineToggle.textContent = isVisible
      ? '\u{1F5C4}\uFE0F'
      : '\u{1F5C3}\uFE0F';
    requestAnimationFrame(()=>fullUpdate());
  });
  mainArea.addEventListener('transitionend', event=>{
    const transition = event as TransitionEvent;
    if(transition.target === mainArea && transition.propertyName.startsWith('grid-template')) fullUpdate();
  });

  getRequiredElement('btnSave').addEventListener('click', showSaveOptions);
  getRequiredElement('btnAbout').addEventListener('click', ()=>helpOverlay.classList.add('show'));
  getRequiredElement('helpClose').addEventListener('click', ()=>helpOverlay.classList.remove('show'));
  helpOverlay.addEventListener('click', (event)=>{
    if(event.target === helpOverlay) helpOverlay.classList.remove('show');
  });
  document.addEventListener('keydown', (event: KeyboardEvent)=>{
    if(event.key === 'Escape') helpOverlay.classList.remove('show');
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
      if(event.key.toLowerCase() === 's') void saveDocument();
      else (getRequiredElement(buttonId) as HTMLButtonElement).click();
      return;
    }

    if(event.key.toLowerCase() === 'z'){
      event.preventDefault();
      undoDocument();
      return;
    }

    if(event.key.toLowerCase() === 'a'){
      event.preventDefault();
      focusEditorAtSelection(chapterModeLevel !== 0 ? editorViewRange.start : 0,
        chapterModeLevel !== 0 ? editorViewRange.contentEnd : documentText.length);
    }
  });
  function getEditorSelection(){
    const rawStart = editContext ? editContext.selectionStart : editorViewRange.start + textarea.selectionStart;
    const rawEnd = editContext ? editContext.selectionEnd : editorViewRange.start + textarea.selectionEnd;
    const start = Math.min(rawStart, rawEnd);
    let end = Math.max(rawStart, rawEnd);
    const renderedSelectionText = editContext && document.activeElement === highlightLayer
      ? document.getSelection()?.toString() ?? ''
      : textarea.value.slice(start - editorViewRange.start, end - editorViewRange.start);
    if(documentText.slice(start, end).includes('\n') && !renderedSelectionText.includes('\n')){
      end = Math.min(end, start + renderedSelectionText.replace(/\u200b/g, '').length);
    }
    return {start, end};
  }

  function focusEditorAtSelection(start: number, end: number){
    documentSelectionStart = start;
    documentSelectionEnd = end;
    if(editContext){
      editContext.updateSelection(start, end);
    }
    syncEditorViewRange();
    renderHighlight();
    renderLineNumbers();
    setTextareaSelectionFromDocument(start, end);
    if(editContext){
      (highlightLayer as HTMLElement).focus({preventScroll:true});
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

  getRequiredElement('btnCopy').addEventListener('click', ()=>{
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

  getRequiredElement('btnCut').addEventListener('click', ()=>{
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

  getRequiredElement('btnPaste').addEventListener('click', ()=>{
    const {start, end} = getEditorSelection();
    const applyPastedText = (text: string)=>replaceEditorRange(start, end, text.replace(/\r\n?/g, '\n'));
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
  getRequiredElement('btnSearch').addEventListener('click', openSearchPanel);
  newlineToggle.addEventListener('click', ()=>{
    showNewlineMarkers = !showNewlineMarkers;
    newlineToggle.setAttribute('aria-pressed', String(showNewlineMarkers));
    newlineToggle.title = '改行コード表示: ' + (showNewlineMarkers ? 'ON' : 'OFF');
    if(showNewlineMarkers) renderNewlineMarkers();
    else newlineLayer.replaceChildren();
  });
  blockModeToggle.addEventListener('click', ()=>{
    chapterModeLevel = (chapterModeLevel === 2 ? 0 : chapterModeLevel + 1) as 0 | 1 | 2;
    if(chapterModeLevel !== 0) activeChapterStart = getChapterRangeAt(getEditorSelection().start, chapterModeLevel).start;
    else activeChapterStart = null;
    blockModeToggle.textContent = '📖' + chapterModeLevel;
    blockModeToggle.setAttribute('aria-label', 'ブロック表示モード レベル' + chapterModeLevel);
    blockModeToggle.setAttribute('aria-pressed', String(chapterModeLevel !== 0));
    blockModeToggle.title = 'ブロック表示モード: ' + chapterModeLevel;
    fullUpdate();
  });
  getRequiredElement('searchNext').addEventListener('click', ()=>searchFrom(1));
  getRequiredElement('searchPrevious').addEventListener('click', ()=>searchFrom(-1));
  getRequiredElement('replaceCurrent').addEventListener('click', ()=>{
    const match = activeSearchMatch;
    if(!match || documentText.slice(match.start, match.end) !== match.query){
      searchMessage.textContent = '先に検索してください';
      return;
    }
    const replaceCurrentMatch = ()=>{
      const matchStart = match.start;
      const matchEnd = match.end;
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
  getRequiredElement('searchClose').addEventListener('click', ()=>{
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
  const btnFontSize = getRequiredElement('btnFontSize');
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
  setDocumentText('');
  initializeEditContext();
  fullUpdate();
})();
