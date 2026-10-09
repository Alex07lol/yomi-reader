# Test Scenarios for Yomi Reader

## Core User Journeys

### 1. Discover and Read a Novel
1. User visits site → sees library with 5 sample novels
2. User clicks "The Shadow Prince" novel card
3. On novel page, sees cover, metadata, volumes, downloads
4. User clicks "Start Reading" button
5. Reader opens at chapter 1 with proper styling
6. User scrolls down → chapter changes tracked in URL
7. User navigates via keyboard → ArrowRight moves to next chapter
8. User closes browser → returns later → Continue Reading shows progress
9. User clicks Continue Reading → returns to exact chapter/scroll position

### 2. Library Filtering and Search
1. User types "shadow" in search → novels with shadow in title/author/tags show
2. User clicks "Fantasy" genre filter → shows fantasy novels only
3. User clicks "Japanese" source language → shows Japanese novels
4. User clicks "Completed" status → shows completed novels
5. User changes sort to "Alphabetical" → novels reorder A-Z
6. User clears filters → returns to full library

### 3. Reader Customization
1. While reading, user clicks "Aa" (settings) button
2. Settings panel opens with sliders for font size, line height, width, margins
3. User adjusts font size → text resizes immediately
4. User switches theme to "Sepia" → colors change instantly
5. User changes font to "Sans-serif" → font family updates
6. User closes settings → preferences persist across sessions
7. User switches to "System" theme → follows OS preference

### 4. Navigation and Deep Linking
1. User is reading chapter 5 of Shadow Prince
2. URL shows: #reader/shadow-prince/sp-ch-5
3. User shares URL with friend
4. Friend opens URL → reader opens directly to chapter 5
5. User opens chapter drawer → sees current chapter highlighted
6. User clicks volume 2 in drawer → jumps to chapter 9
7. User clicks chapter title in drawer → navigates to that chapter
8. User presses Escape → drawer closes

### 5. Mobile Experience
1. User visits on mobile browser
2. Library shows vertical layout with full-width filters
3. Novel card taps open novel page
4. Reader shows mobile controls at bottom (prev/chapter/next)
5. User swipes left → advances to next chapter
6. User taps chapter icon → drawer slides in from left
7. User taps chapter in drawer → navigates and drawer closes
8. User rotates device → layout adapts appropriately

### 6. EPUB Downloads
1. On novel page, user sees Downloads section
2. User clicks "Complete Novel (EN)" link
3. Browser downloads EPUB file with proper filename
4. User clicks volume-specific download → gets that volume EPUB
5. Download shows file size in MB/KB format

### 7. EPUB Import (Admin)
1. User navigates to /admin via footer link
2. User selects EPUB file via drag & drop or file picker
3. System parses EPUB and shows metadata review
4. Warnings appear if metadata missing/invalid
5. Detected volumes shown with chapter counts
6. Publish button shows stub message (ready for backend integration)

## Edge Cases Tested
- Empty library state
- Novel with no chapters
- Reading progress save/restore
- Settings persistence across theme switches
- URL handling for invalid novel/chapter IDs
- Keyboard navigation boundaries (first/last chapter)
- Touch swipe thresholds to prevent false triggers
- Mobile toolbar collapsing on scroll
- Long chapter content performance
- Very wide/narrow viewport handling