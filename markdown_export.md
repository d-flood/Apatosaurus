# Markdown Transcription Exporter

## Overview

This document outlines the implementation plan for a new markdown exporter that outputs transcription documents in a custom markdown syntax designed for manuscript transcription.

## Target Markdown Syntax

```markdown
# A Simple Transcription Example
## FirstName LastName
### 2021-05-12

#### Romans
##### 11
<pb n="323v"/>
<lb/> words are tokenized
<lb/>
<v n="5">shortcut tag for verse unit
<lb/> [supp]lied [text] in brackets
<lb/> unclear `text` in back`ticks`
<lb/> some text followed by commentary <comm/>
<comm lines="3"/>
<lb/> **marginalia in double-asterisks**
<lb/> a word bro-<lb n="8"/>ken over two lines
<lb/> {unencoded notes in braces}
<lb/> *encoded editer's note in single asterisks*
<lb/> ++ corrected text | corrected text ++
<lb/> add attributes to an `element`{reason='damage to page'}
</v>
```

## Schema Mapping

### ProseMirror Schema → Markdown Syntax

| Markdown Syntax | ProseMirror Schema | Implementation Notes |
|----------------|-------------------|---------------------|
| `# Title` | Metadata | Document title from metadata |
| `## FirstName LastName` | Metadata | Transcriber name from metadata |
| `### 2021-05-12` | Metadata | Transcription date from metadata |
| `#### Book` | `book` node | Book name (e.g., "Romans") |
| `##### Chapter` | `chapter` node | Chapter number (e.g., "11") |
| `<pb n="323v"/>` | `page` node | Page break with folio number from `pageName` attr |
| `<lb/>` | `line` node | Standard line break |
| `<lb n="8"/>` | `line` node | Line break with explicit line number |
| `<v n="5">` | `verse` node | Verse unit opening tag |
| `</v>` | verse change | Verse unit closing (implicit on verse change) |
| `[supplied text]` | `lacunose` mark | Supplied/reconstructed text in brackets |
| `` `unclear` `` | `unclear` mark | Uncertain reading in backticks |
| `word bro-<lb/>ken` | `line` with `wrapped=true` | Hyphenated word across lines |
| `++ orig \| corr ++` | `correction` mark | Original \| corrected text |
| `{notes}` | `untranscribed` mark | Unencoded editorial notes |
| `<gap{...}/>` | `gap` node | Gap with optional attributes |
| `<comm/>` | *Not in schema* | Commentary marker (future) |
| `<comm lines="3"/>` | *Not in schema* | Multi-line commentary (future) |
| `**marginalia**` | *Not in schema* | Marginal notes (future) |
| `*editor's note*` | *Not in schema* | Editorial notes (future) |

## File Structure

### Main Export File
**Location:** `/app/src/lib/tei/markdown-exporter.ts`

```typescript
interface MarkdownMetadata {
	title?: string;
	transcriber?: string;
	date?: string;
}

export function exportMarkdown(
	pmJSON: ProseMirrorJSON,
	metadata?: MarkdownMetadata
): string
```

### Test File
**Location:** `/app/src/lib/tei/markdown-exporter.spec.ts`

Follow the pattern established in `tei-exporter.spec.ts` with comprehensive test coverage.

## Implementation Architecture

### 1. Context Structure

```typescript
interface MarkdownContext {
	lines: string[];
	currentBook?: string;
	currentChapter?: string;
	currentVerse?: string;
	insideVerse: boolean;
	currentLine: string[];
}
```

### 2. Export Flow

```
1. Generate header (# title, ## transcriber, ### date)
2. Process manuscript content:
   a. Track current book/chapter/verse context
   b. For each page:
      - Output #### Book (when book changes)
      - Output ##### Chapter (when chapter changes)
      - Output <pb n="pageName"/>
   c. For each column (transparent in markdown)
   d. For each line:
      - Output <lb/> or <lb n="N"/> (with line number if not sequential)
      - Process inline content with word tokenization
      - Handle verse markers
      - Apply mark syntax to text
3. Close any open verse tags
```

### 3. Header Generation

```typescript
function generateHeader(metadata?: MarkdownMetadata): string[] {
	const title = metadata?.title || 'Transcription';
	const transcriber = metadata?.transcriber || 'Anonymous';
	const date = metadata?.date || new Date().toISOString().split('T')[0];
	
	return [
		`# ${title}`,
		`## ${transcriber}`,
		`### ${date}`,
		'',
	];
}
```

### 4. Node Processing

#### Page Node
```typescript
case 'page': {
	const pageName = node.attrs?.pageName || '';
	context.lines.push(`<pb n="${pageName}"/>`);
	// Process page content
	break;
}
```

#### Line Node
```typescript
case 'line': {
	const lineAttrs = node.attrs || {};
	const lineNumber = lineAttrs.lineNumber;
	const wrapped = lineAttrs.wrapped || false;
	
	// Determine if we need explicit line number
	const needsExplicitNumber = /* logic */;
	
	if (needsExplicitNumber) {
		context.lines.push(`<lb n="${lineNumber}"/>`);
	} else {
		context.lines.push('<lb/>');
	}
	
	// Process line content with word tokenization
	exportLineContent(node.content, context);
	break;
}
```

#### Book/Chapter Nodes
```typescript
case 'book': {
	const book = node.attrs?.book || '';
	if (book !== context.currentBook) {
		closeVerse(context);
		context.lines.push(`#### ${book}`);
		context.currentBook = book;
	}
	break;
}

case 'chapter': {
	const chapter = node.attrs?.chapter || '';
	if (chapter !== context.currentChapter) {
		closeVerse(context);
		context.lines.push(`##### ${chapter}`);
		context.currentChapter = chapter;
	}
	break;
}
```

#### Verse Node
```typescript
case 'verse': {
	const verse = node.attrs?.verse || '';
	const verseId = buildVerseId(node.attrs);
	
	if (context.insideVerse && verseId !== context.currentVerse) {
		closeVerse(context);
	}
	
	if (!context.insideVerse) {
		context.currentLine.push(`<v n="${verse}">`);
		context.insideVerse = true;
		context.currentVerse = verseId;
	}
	break;
}
```

#### Gap Node
```typescript
case 'gap': {
	const attrs = node.attrs || {};
	let gapTag = '<gap';
	
	const attrPairs: string[] = [];
	if (attrs.reason) attrPairs.push(`reason='${attrs.reason}'`);
	if (attrs.unit) attrPairs.push(`unit='${attrs.unit}'`);
	if (attrs.extent) attrPairs.push(`extent='${attrs.extent}'`);
	
	if (attrPairs.length > 0) {
		gapTag += `{${attrPairs.join(' ')}}`;
	}
	gapTag += '/>';
	
	context.currentLine.push(gapTag);
	break;
}
```

### 5. Mark Rendering

```typescript
function exportTextWithMarks(node: ProseMirrorJSON): string {
	let text = node.text || '';
	const marks = node.marks || [];
	
	for (const mark of marks) {
		switch (mark.type) {
			case 'lacunose':
				text = `[${text}]`;
				break;
			
			case 'unclear':
				text = `\`${text}\``;
				break;
			
			case 'correction': {
				const corrected = mark.attrs?.correctionText || '';
				text = `++ ${text} | ${corrected} ++`;
				break;
			}
			
			case 'untranscribed': {
				const reason = mark.attrs?.reason || '';
				text = `{${text}}`;
				break;
			}
			
			case 'abbreviation': {
				const expansion = mark.attrs?.expansion || '';
				// Handle abbreviation with overline representation
				// This may need special handling
				break;
			}
		}
	}
	
	return text;
}
```

### 6. Word Tokenization

Reuse the word grouping logic from TEI exporter:

```typescript
function exportLineContent(nodes: ProseMirrorJSON[], context: MarkdownContext): void {
	const words = groupIntoWords(nodes);
	
	for (const word of words) {
		if (word.type === 'verse') {
			// Handle verse marker
		} else if (word.type === 'gap') {
			// Handle gap
		} else if (word.type === 'word' && word.content) {
			// Export word with marks
			for (const node of word.content) {
				context.currentLine.push(exportTextWithMarks(node));
			}
		}
	}
	
	// Join current line and add to output
	context.lines.push(context.currentLine.join(' '));
	context.currentLine = [];
}
```

### 7. Line Wrapping (Hyphenation)

When a line has `wrapped=true`, the last word should be followed by a hyphen before the line break:

```typescript
function exportLineContent(nodes: ProseMirrorJSON[], context: MarkdownContext, wrapped: boolean): void {
	// ... process content ...
	
	const lineContent = context.currentLine.join(' ');
	
	if (wrapped) {
		// Add hyphen before next line break
		context.lines[context.lines.length - 1] += lineContent + '-';
	} else {
		context.lines.push(lineContent);
	}
	
	context.currentLine = [];
}
```

### 8. Verse Management

```typescript
function openVerse(context: MarkdownContext, verseId: string, verse: string): void {
	if (!context.insideVerse) {
		context.currentLine.push(`<v n="${verse}">`);
		context.insideVerse = true;
		context.currentVerse = verseId;
	}
}

function closeVerse(context: MarkdownContext): void {
	if (context.insideVerse) {
		context.currentLine.push('</v>');
		context.insideVerse = false;
		context.currentVerse = undefined;
	}
}
```

## Special Cases & Edge Cases

### 1. Line Wrapping
When `line.attrs.wrapped === true`:
- Append `-` to the end of the line content
- The next line continues the word without space

Example:
```
<lb/> a word bro-
<lb n="8"/>ken continues
```

### 2. Verse Spanning Multiple Lines
Verses can span multiple lines. The `<v>` tag opens when a verse node is encountered and closes:
- When a different verse is encountered
- When structural elements change (page, book, chapter)
- At the end of the document

### 3. Sequential Line Numbers
Only output `<lb n="N"/>` when the line number is not sequential. Otherwise use `<lb/>`.

### 4. Attributes on Elements
Attributes are added using the `{attr='value'}` syntax:
- `<gap{reason='damage' unit='line' extent='2-3'}/>`
- `` `text`{reason='damage to page'} ``

### 5. Empty Lines
Lines with no content should still output `<lb/>`.

### 6. Column Information
Column information from the schema is not explicitly represented in the markdown output.

## Missing Schema Elements

The following markdown syntax elements are **not currently in the ProseMirror schema**:

1. **Commentary markers:** `<comm/>` and `<comm lines="N"/>`
   - Future: Add `commentary` inline node

2. **Marginalia:** `**text**`
   - Future: Add `marginalia` mark
   - Alternative: Could use existing marks with special attribute

3. **Editor's notes:** `*text*`
   - Future: Add `editorNote` mark
   - Note: Conflicts with markdown italic syntax

### Workarounds for v1

For the initial implementation:
- Skip unsupported elements with a comment or warning
- Or export as plain text with a special marker
- Document which elements are not yet supported

## Testing Strategy

### Test Cases

1. **Basic Structure**
   - Manuscript → Pages → Columns → Lines
   - Verify header generation
   - Verify page breaks

2. **Book/Chapter/Verse Hierarchy**
   - Book changes trigger `#### Book`
   - Chapter changes trigger `##### Chapter`
   - Verse opening and closing logic
   - Verse spanning multiple lines

3. **All Marks**
   - Lacunose: `[text]`
   - Unclear: `` `text` ``
   - Correction: `++ orig | corr ++`
   - Abbreviation with expansion
   - Untranscribed: `{text}`
   - Punctuation handling

4. **Line Wrapping**
   - Words broken across lines with hyphen
   - `wrapped=true` attribute handling

5. **Gap Nodes**
   - Gap with no attributes: `<gap/>`
   - Gap with attributes: `<gap{reason='...' unit='...' extent='...'}/>`

6. **Inline Nodes**
   - Verse markers within lines
   - Book/chapter transitions
   - Multiple inline elements

7. **Complex Nested Marks**
   - Multiple marks on same text
   - Mark precedence and nesting

8. **Real-world Sample**
   - Use existing TEI sample or create new one
   - Export and verify output matches expected format

### Test File Structure

Follow the pattern from `tei-exporter.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { exportMarkdown } from './markdown-exporter';

describe('Markdown Exporter', () => {
	describe('Header Generation', () => {
		it('should generate header with metadata', () => { /* ... */ });
		it('should use defaults when metadata missing', () => { /* ... */ });
	});
	
	describe('Structure Export', () => {
		it('should export pages', () => { /* ... */ });
		it('should export lines', () => { /* ... */ });
	});
	
	describe('Mark Export', () => {
		it('should export lacunose as [text]', () => { /* ... */ });
		it('should export unclear as `text`', () => { /* ... */ });
		// ... more mark tests
	});
	
	describe('Node Export', () => {
		it('should export book milestones', () => { /* ... */ });
		it('should export verse markers', () => { /* ... */ });
		// ... more node tests
	});
	
	describe('Complex Documents', () => {
		it('should export complete document', () => { /* ... */ });
	});
});
```

## Implementation Steps

### Phase 1: Core Structure (High Priority)
1. Create `markdown-exporter.ts` file
2. Define interfaces (MarkdownMetadata, MarkdownContext)
3. Implement main `exportMarkdown()` function skeleton
4. Implement `generateHeader()` function
5. Implement basic node traversal (exportNode, exportNodes)

### Phase 2: Node Processing (High Priority)
6. Implement page node export (`<pb/>`)
7. Implement line node export (`<lb/>`)
8. Implement book/chapter hierarchy (`####`, `#####`)
9. Implement verse opening/closing (`<v>`, `</v>`)
10. Implement gap node with attributes

### Phase 3: Mark Rendering (High Priority)
11. Implement lacunose mark → `[text]`
12. Implement unclear mark → `` `text` ``
13. Implement correction mark → `++ orig | corr ++`
14. Implement untranscribed mark → `{text}`
15. Implement abbreviation/expansion handling

### Phase 4: Special Features (Medium Priority)
16. Implement word tokenization (reuse from TEI)
17. Implement line wrapping with hyphens
18. Implement sequential line number detection
19. Implement attribute syntax `{attr='value'}`

### Phase 5: Testing (Medium Priority)
20. Create test file structure
21. Implement unit tests for each component
22. Create integration tests
23. Test with real-world samples

### Phase 6: Integration (Low Priority)
24. Add export option to UI
25. Add download functionality
26. Documentation

## Dependencies

- **No new dependencies required**
- Reuse `ProseMirrorJSON` interface from TEI exporter
- Follow same patterns as `tei-exporter.ts`

## Code Conventions

Following the project's code style:
- Use tabs for indentation
- Single quotes for strings
- No semicolons (except where required)
- TypeScript strict mode
- Prefer explicit types over inference for public APIs
- Prefer functional approach over classes

## Future Enhancements

1. **Schema Extensions**
   - Add `commentary` node for `<comm/>`
   - Add `marginalia` mark for `**text**`
   - Add `editorNote` mark for `*text*`

2. **Export Options**
   - Option to include/exclude metadata
   - Option to use full verse references vs. shorthand
   - Option for line number display

3. **Import Support**
   - Reverse operation: markdown → ProseMirror JSON
   - Allow round-trip editing

4. **Validation**
   - Validate exported markdown against schema
   - Warning for unsupported elements

## References

- Existing implementation: `app/src/lib/tei/tei-exporter.ts`
- Schema definition: `app/src/lib/client/transcriptionEditorSchema.ts`
- Test examples: `app/src/lib/tei/tei-exporter.spec.ts`
