---
name: Workspace.tsx hook ordering
description: React hook / useCallback ordering rules in Workspace.tsx to avoid TDZ errors
---

# Workspace.tsx — callback declaration order

## Rule
Callbacks that depend on `waLiveStatus` or `loadInitial` **must** be declared AFTER those variables are initialized in the component body.

## Why
JavaScript `const` declarations inside a function body have a temporal dead zone (TDZ). React's `useCallback` runs immediately during render, so if callback A references callback B which is declared later with `const`, A will crash with "Cannot access 'B' before initialization".

## Current safe order (as of implementation)
1. `stopRecording` / `startRecording`
2. `waLiveStatus` state declaration (moved up from its original position)
3. `isAutoRefreshing` state
4. `pendingImages` state + `handleImageSelect`
5. API data hooks (useGetRelation, useListAgentSessions, etc.)
6. `loadInitial` callback
7. `loadScheduled` + `handleWaDirectSend` callbacks ← must be AFTER loadInitial
8. Live refresh effects

## How to apply
When adding a new callback that calls `loadInitial`, `loadScheduled`, or reads `waLiveStatus`, place it after the `loadInitial` definition (~line 330). Never place it in the early callback section after `stopRecording`.
