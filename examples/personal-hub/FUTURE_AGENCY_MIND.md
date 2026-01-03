# Future Steps: Agency Mind & Self-Aware Infrastructure

This document outlines the future development path for making the Agent Hub infrastructure "alive" - inspired by The Culture series where Minds manage vast systems through coordination rather than direct control.

## Current Implementation (Phase 1)

### What We Built

1. **Agency Management Plugin** (`hub/plugins/agency-management.ts`)
   - ~25 tools for introspecting and managing an agency
   - Injects agency context into the system prompt (blueprints, agents, schedules, vars)
   - Covers blueprints, agents, schedules, and variables

2. **Agency Mind Blueprint** (`hub/agents/agency-mind.ts`)
   - Self-aware agent that can manage its parent agency
   - Has subagent capability for deep inspection tasks
   - Full control over agency configuration

3. **Agency Inspector Blueprint** (`hub/agents/agency-inspector.ts`)
   - Subagent for context-heavy operations
   - Analyzes conversations, events, and state
   - Cannot spawn further subagents (prevents recursion)

---

## Phase 2: UI Integration

### "Talk to Agency" Feature

Add a dedicated interface for conversing with the Agency Mind.

**Implementation Options:**

1. **Dedicated Tab**
   - Add a "Mind" tab alongside Chat, Trace, Files, Todos
   - Always connects to the `_agency-mind` agent for this agency
   - Persists conversation across sessions

2. **Floating Assistant**
   - Clippy-style floating button that expands to a chat
   - Context-aware: knows what page/agent you're looking at
   - Could suggest actions based on current view

3. **Integrated into Sidebar**
   - Agency Mind is a special "pinned" agent in the sidebar
   - Always accessible, distinct from regular agents

**Suggested First Implementation:**
- Add a "Mind" icon/button in the agency header
- Opens a slide-out panel with chat interface
- Uses existing ChatView component
- Creates/connects to `_agency-mind` agent automatically

**Files to Modify:**
- `ui/App.tsx` - Add Mind panel state and routing
- `ui/components/Sidebar.tsx` - Add Mind quick-access button
- `ui/hooks/useAgentSystem.ts` - Add `getOrCreateMind()` helper

---

## Phase 3: Hub Mind

### The Top-Level Intelligence

The Hub Mind sits above agencies and manages the entire hub.

**What It Would Know:**
- All agencies in the hub
- Global configuration
- Cross-agency patterns and insights
- System health and usage

**What It Could Do:**
- Create, list, and delete agencies
- Explain how the hub works
- Suggest optimizations
- Help onboard new users

**Implementation:**

1. **Hub Management Plugin** (`hub/plugins/hub-management.ts`)
   ```typescript
   // Tools:
   // - list_agencies
   // - create_agency
   // - delete_agency
   // - get_hub_stats
   // - get_agency_summary
   ```

2. **Hub Mind Blueprint** (`hub/agents/hub-mind.ts`)
   - Lives outside any specific agency (or in a special "system" agency)
   - Has `hub-management` capability
   - Can spawn Agency Minds for deep dives

**Challenge: Where Does It Live?**

Options:
- Special "system" agency that exists by default
- Direct binding to the Worker (not an agency)
- First-class Hub Mind DO (new concept)

Recommendation: Create a special `_system` agency that's auto-created and contains Hub Mind. This reuses existing infrastructure.

---

## Phase 4: Voice Interface

### Talking to Your AIs

The vision of conversing with your hub via voice.

**Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│                     Voice Interface                      │
├─────────────────────────────────────────────────────────┤
│  Speech-to-Text → Text → Agent → Text → Text-to-Speech  │
└─────────────────────────────────────────────────────────┘
```

**Implementation Approaches:**

1. **Browser-Based (Simplest)**
   - Use Web Speech API for STT
   - Use Web Speech Synthesis for TTS
   - Works in Chrome, Safari, Edge
   - No additional infrastructure needed
   
   ```typescript
   // In UI
   const recognition = new webkitSpeechRecognition();
   recognition.onresult = (event) => {
     const transcript = event.results[0][0].transcript;
     sendMessage(transcript);
   };
   ```

2. **Cloud-Based (Higher Quality)**
   - Whisper for STT (via OpenAI API or self-hosted)
   - ElevenLabs, OpenAI TTS, or Coqui for TTS
   - Better accuracy, more natural voices
   - Requires API keys and adds latency

3. **Hybrid**
   - Browser STT for input (real-time, no latency)
   - Cloud TTS for output (better quality voices)

**UI Considerations:**
- Microphone button in chat interface
- Voice activity indicator
- Option to enable/disable voice
- Push-to-talk vs. continuous listening modes

**Files to Create:**
- `ui/hooks/useVoice.ts` - Voice input/output logic
- `ui/components/VoiceButton.tsx` - Mic button component

---

## Phase 5: Proactive Intelligence

### Minds That Anticipate

Beyond reactive assistance, Minds could proactively help.

**Examples:**

1. **Agency Mind Suggestions**
   - "I noticed agent X has been failing frequently. Want me to investigate?"
   - "Your daily-report schedule hasn't run in 3 days. Should I check it?"
   - "Blueprint Y hasn't been used in 30 days. Consider archiving?"

2. **Hub Mind Insights**
   - "Agency 'personal' has grown to 50 agents. Consider cleanup?"
   - "You've been creating similar blueprints. Want me to suggest a template?"

**Implementation:**

1. **Background Analysis Jobs**
   - Scheduled tasks that analyze agency/hub state
   - Generate insights and suggestions
   - Store in a suggestions table

2. **Notification System**
   - UI component to show Mind suggestions
   - Dismiss or act on suggestions
   - Feedback loop to improve suggestions

---

## Phase 6: Inter-Agent Communication

### Agents Talking to Each Other

Currently, subagents report back to parents. Future: peer communication.

**Use Cases:**
- Agent A discovers something relevant to Agent B
- Collaborative multi-agent workflows
- Shared memory/context between agents

**Implementation Considerations:**
- Message bus or pub/sub system
- Security: which agents can talk to which?
- Context sharing without leaking sensitive data

---

## Technical Notes

### Making Blueprints Available

The vite plugin auto-discovers blueprints in `hub/agents/`. The new blueprints should be automatically included when running `npm run dev`.

Verify with:
```bash
# Check _generated.ts includes new blueprints
grep "agency-mind" examples/personal-hub/_generated.ts
```

### Testing the Agency Mind

1. Start the dev server: `npm run dev`
2. Create or select an agency
3. Spawn an `_agency-mind` agent
4. Ask it about the agency: "What blueprints do I have?"
5. Try modifications: "Create a new blueprint called test-agent"

### Potential Issues

1. **Circular Dependencies**
   - Agency Mind calls Agency API
   - Agency manages agents including Agency Mind
   - Should be fine since calls go through HTTP

2. **Context Window**
   - Agency info injected each turn
   - Large agencies might need summarization
   - Inspector subagent helps with deep dives

3. **Permission Model**
   - Currently full trust (personal hub)
   - Production would need auth/permissions
   - Consider adding capability restrictions

---

## Inspiration

From Iain M. Banks' Culture series:

> "The Culture's Minds were... the ultimate in artificial intelligence... They ran everything, and did so with an almost casual ease."

The goal is infrastructure that's not just automated, but *intelligent* - understanding itself, explaining itself, and improving itself. The Hub Mind and Agency Minds are the first steps toward this vision.

---

## Next Actions

1. **Test Current Implementation**
   - Spawn `_agency-mind` and verify tools work
   - Test inspector subagent for deep analysis

2. **Add UI Integration**
   - Start with simple "Mind" button in header
   - Iterate based on usage

3. **Consider Hub Mind**
   - Design the `_system` agency concept
   - Implement hub-management plugin

4. **Explore Voice**
   - Prototype with Web Speech API
   - Evaluate quality vs. cloud options
