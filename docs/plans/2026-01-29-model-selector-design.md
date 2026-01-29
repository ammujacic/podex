# Model Selector UI Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create detailed implementation plan after design approval.

**Goal:** Replace simple model dropdowns with a comprehensive tabbed model selector supporting OpenRouter (Podex credits), BYOK providers, and local Ollama models.

**Architecture:** React component with tabs, virtualized list for 200+ models, local storage favorites, and category-based filtering. Reusable across workspace and settings pages.

**Tech Stack:** React, Zustand store, TanStack Virtual (list virtualization), Tailwind CSS

---

## Design Decisions

| Decision           | Choice             | Rationale                                                               |
| ------------------ | ------------------ | ----------------------------------------------------------------------- |
| Tab Organization   | By Source          | Cleanly separates billing: Podex credits vs user API keys vs free local |
| Model Display      | Curated subset     | ~35 featured models prevent overwhelm; "Show all" for power users       |
| Component Location | Current + Settings | Reusable component, same experience everywhere                          |
| Favorites Storage  | LocalStorage       | No backend needed, instant, persists across sessions                    |

---

## Component Architecture

```
src/components/model-selector/
├── ModelSelector.tsx           # Main container with tabs
├── ModelSelectorTabs.tsx       # Tab navigation component
├── ModelSelectorContent.tsx    # Tab content switcher
├── ModelSearch.tsx             # Search input with debounce
├── ModelFilters.tsx            # Category filter chips
├── ModelList.tsx               # Virtualized scrollable list
├── ModelCard.tsx               # Individual model row/card
├── FavoritesSection.tsx        # Pinned favorites at top
├── EmptyState.tsx              # No results / setup prompts
├── index.ts                    # Public exports
└── hooks/
    ├── useModelSearch.ts       # Search + filter logic
    ├── useModelFavorites.ts    # LocalStorage favorites management
    └── useModelDiscovery.ts    # Ollama auto-discovery
```

### State Management

```typescript
// stores/models.ts
interface ModelStore {
  // Data
  models: LLMModel[];
  favorites: string[]; // model IDs

  // Filters
  activeTab: 'podex' | 'your-keys' | 'local';
  searchQuery: string;
  activeCategories: string[];
  showAllModels: boolean;

  // Actions
  setActiveTab: (tab: string) => void;
  setSearchQuery: (query: string) => void;
  toggleCategory: (category: string) => void;
  toggleFavorite: (modelId: string) => void;
  toggleShowAll: () => void;

  // Computed
  filteredModels: () => LLMModel[];
}
```

---

## Tab Structure

### Tab 1: Podex (Default)

Models available through OpenRouter, billed to Podex credits.

**Default View:**

- Favorites section at top (if any)
- Featured models (~35) grouped by category
- "Show all 200+ models" toggle at bottom

**Expanded View (Show All):**

- Full OpenRouter catalog
- Infinite scroll with virtualization
- Search becomes essential

**Categories:**

- ⚡ Fast — Low latency, quick responses
- 🧠 Reasoning — Complex analysis, chain-of-thought
- 💻 Code — Programming, debugging, code generation
- 👁️ Vision — Image understanding, multimodal
- 📚 Large Context — 100K+ token windows
- 💰 Budget — Cost-effective for high volume

### Tab 2: Your Keys

Models using user-provided API keys, billed directly to their accounts.

**Sections (collapsible):**

```
▼ Anthropic (API key configured)
  └── Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus

▼ OpenAI (API key configured)
  └── GPT-4o, GPT-4o-mini, o1-preview, o1-mini

▶ Google (No API key)
  └── [Add API Key] button
```

**Empty State:**
"Configure your API keys in Settings to use models with your own billing."
[Go to Settings →]

### Tab 3: Local

Self-hosted models via Ollama, free to use.

**Connected State:**

- Auto-discovered models from running Ollama instance
- Model name, size, quantization info
- [Refresh] button to re-scan

**Disconnected State:**
"No local models detected"

- Check Ollama is running at localhost:11434
- [Refresh] [Setup Guide →]

---

## Model Card Design

### Compact View (Default)

```
┌──────────────────────────────────────────────────────────────┐
│ ⭐ Claude 3.5 Sonnet                           ♡  ⚡ 🧠 💻   │
│ anthropic/claude-3.5-sonnet                                  │
│ 200K context  •  $3 / $15 per 1M tokens         [Recommended]│
└──────────────────────────────────────────────────────────────┘
```

**Elements:**

- ⭐ Featured indicator (filled star for featured)
- Model display name (primary)
- Model ID / slug (secondary, muted)
- ♡ Favorite toggle (heart, filled when favorited)
- Category badges (icon pills)
- Context window
- Pricing (input/output per 1M tokens)
- [Recommended] badge for top picks

### Expanded View (on hover/click)

```
┌──────────────────────────────────────────────────────────────┐
│ ⭐ Claude 3.5 Sonnet                           ♡  ⚡ 🧠 💻   │
│ anthropic/claude-3.5-sonnet                                  │
├──────────────────────────────────────────────────────────────┤
│ Context: 200,000 tokens                                      │
│ Input:   $3.00 / 1M tokens                                   │
│ Output:  $15.00 / 1M tokens                                  │
│                                                              │
│ Best for coding, analysis, and complex reasoning tasks.      │
│ Excellent instruction following with fast response times.    │
│                                                [Select Model]│
└──────────────────────────────────────────────────────────────┘
```

---

## Search & Filter Behavior

### Search

- Debounced (300ms) to prevent excessive filtering
- Searches: display name, model ID, provider name
- Case-insensitive, partial match
- Highlights matching text in results

### Category Filters

- Chips displayed horizontally, scrollable on mobile
- Multiple categories can be active (OR logic)
- Active chips have accent color background
- Click to toggle on/off

### Combined Logic

```
filteredModels = models
  .filter(matchesActiveTab)
  .filter(matchesSearchQuery)
  .filter(matchesCategoryFilter OR noFiltersActive)
  .filter(isFeatured OR showAllModels)
  .sort(byFavoritesFirst, byFeaturedFirst, byDisplayOrder)
```

---

## Database Schema Changes

### New Columns on `llm_models`

```sql
ALTER TABLE llm_models ADD COLUMN is_featured BOOLEAN DEFAULT FALSE;
ALTER TABLE llm_models ADD COLUMN display_order INTEGER DEFAULT 0;
ALTER TABLE llm_models ADD COLUMN categories TEXT[] DEFAULT '{}';
ALTER TABLE llm_models ADD COLUMN short_description TEXT;
```

### Categories Enum

```python
class ModelCategory(str, Enum):
    FAST = "fast"
    REASONING = "reasoning"
    CODE = "code"
    VISION = "vision"
    LARGE_CONTEXT = "large_context"
    BUDGET = "budget"
```

---

## Featured Model Curation

**~35 models across categories:**

### Fast (8 models)

| Model            | Provider  | Why Featured                 |
| ---------------- | --------- | ---------------------------- |
| GPT-4o-mini      | OpenAI    | Best price/performance ratio |
| Claude 3.5 Haiku | Anthropic | Fast, capable, affordable    |
| Gemini 1.5 Flash | Google    | Very fast, large context     |
| Llama 3.1 8B     | Meta      | Open source, fast            |
| Mistral Small    | Mistral   | Efficient, multilingual      |
| DeepSeek V3      | DeepSeek  | Excellent value              |
| Qwen 2.5 7B      | Alibaba   | Strong multilingual          |
| Phi-3 Medium     | Microsoft | Small but capable            |

### Reasoning (6 models)

| Model             | Provider  | Why Featured              |
| ----------------- | --------- | ------------------------- |
| Claude 3.5 Sonnet | Anthropic | Best all-around           |
| GPT-4o            | OpenAI    | Strong reasoning          |
| o1-preview        | OpenAI    | Chain-of-thought          |
| o1-mini           | OpenAI    | Fast reasoning            |
| DeepSeek R1       | DeepSeek  | Open reasoning model      |
| Gemini 1.5 Pro    | Google    | Large context + reasoning |

### Code (8 models)

| Model              | Provider  | Why Featured               |
| ------------------ | --------- | -------------------------- |
| Claude 3.5 Sonnet  | Anthropic | Excellent code generation  |
| GPT-4o             | OpenAI    | Strong coding              |
| DeepSeek Coder V2  | DeepSeek  | Code-specialized           |
| CodeLlama 70B      | Meta      | Open source code model     |
| Qwen 2.5 Coder 32B | Alibaba   | Strong code capabilities   |
| Starcoder2 15B     | BigCode   | Code completion            |
| WizardCoder 34B    | WizardLM  | Instruction-tuned for code |
| Codestral          | Mistral   | Fast code model            |

### Vision (6 models)

| Model                | Provider  | Why Featured           |
| -------------------- | --------- | ---------------------- |
| GPT-4o               | OpenAI    | Best vision            |
| Claude 3.5 Sonnet    | Anthropic | Strong vision          |
| Gemini 1.5 Pro       | Google    | Vision + large context |
| Llama 3.2 90B Vision | Meta      | Open multimodal        |
| Qwen2-VL 72B         | Alibaba   | Strong vision          |
| Pixtral Large        | Mistral   | Vision model           |

### Large Context (4 models)

| Model             | Provider  | Context     |
| ----------------- | --------- | ----------- |
| Gemini 1.5 Pro    | Google    | 2M tokens   |
| Claude 3.5 Sonnet | Anthropic | 200K tokens |
| GPT-4o            | OpenAI    | 128K tokens |
| Command R+        | Cohere    | 128K tokens |

### Budget (3 models)

| Model        | Provider | Why Featured      |
| ------------ | -------- | ----------------- |
| Llama 3.1 8B | Meta     | Free-tier quality |
| Mistral 7B   | Mistral  | Efficient         |
| Gemma 2 9B   | Google   | Small, capable    |

---

## Responsive Design

### Desktop (>1024px)

- Full width selector in settings
- Modal or slide-out panel in workspace
- 3 columns for model cards in grid view

### Tablet (768-1024px)

- 2 columns for model cards
- Tabs remain horizontal

### Mobile (<768px)

- Full screen modal
- Tabs become scrollable
- Single column model cards
- Category filters in horizontal scroll
- Search sticky at top

---

## Accessibility

- Keyboard navigation (Tab, Arrow keys, Enter)
- ARIA labels on all interactive elements
- Focus indicators on cards
- Screen reader announcements for filter changes
- Reduced motion support

---

## Implementation Notes

### Virtualization

Use `@tanstack/react-virtual` for the model list to handle 200+ models:

```tsx
const virtualizer = useVirtualizer({
  count: filteredModels.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 72, // Model card height
  overscan: 5,
});
```

### Favorites Persistence

```typescript
// hooks/useModelFavorites.ts
const STORAGE_KEY = 'podex-model-favorites';

export function useModelFavorites() {
  const [favorites, setFavorites] = useState<string[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  const toggleFavorite = (modelId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return { favorites, toggleFavorite, isFavorite: (id: string) => favorites.includes(id) };
}
```

### Ollama Discovery

```typescript
// hooks/useModelDiscovery.ts
export function useOllamaModels() {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discover = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      const data = await response.json();
      setModels(data.models.map(transformOllamaModel));
      setError(null);
    } catch (e) {
      setError('Could not connect to Ollama');
      setModels([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    discover();
  }, []);

  return { models, isLoading, error, refresh: discover };
}
```

---

## Migration Path

1. **Phase 1:** Add new columns to `llm_models` table
2. **Phase 2:** Seed featured models with categories and display order
3. **Phase 3:** Build new `ModelSelector` component
4. **Phase 4:** Replace `PlanningModelSelector` usage
5. **Phase 5:** Add to Settings page
6. **Phase 6:** Remove old component

---

## Success Metrics

- [ ] All 3 tabs functional with correct filtering
- [ ] Search returns relevant results within 300ms
- [ ] Favorites persist across sessions
- [ ] Ollama discovery works when Ollama is running
- [ ] No scroll jank with 200+ models (virtualization working)
- [ ] Mobile layout usable on 375px width
- [ ] Keyboard navigation complete
