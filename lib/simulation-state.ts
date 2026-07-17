import type { InvestigationSimulationState } from "./types";

export const FINAL_SIMULATION_STEP = 6;

export function advanceSimulation(state: InvestigationSimulationState): InvestigationSimulationState {
  if (!state.running || state.completed) return state;
  const stepIndex = Math.min(state.stepIndex + 1, FINAL_SIMULATION_STEP);
  const completed = stepIndex === FINAL_SIMULATION_STEP;
  return { ...state, stepIndex, completed, running: completed ? false : state.running };
}

export function pauseSimulation(state: InvestigationSimulationState): InvestigationSimulationState {
  return { ...state, running: false };
}

export function resumeSimulation(state: InvestigationSimulationState): InvestigationSimulationState {
  return state.completed ? state : { ...state, running: true };
}
