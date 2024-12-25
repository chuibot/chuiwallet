import { createSlice } from '@reduxjs/toolkit';

import { updateVersion } from '../global/actions';

export type TabOption = 'home' | 'discover' | 'settings';

export interface GlobalState {
  tab: TabOption;
  isUnlocked: boolean;
  isReady: boolean;
  isBooted: boolean;
}

export const initialState: GlobalState = {
  tab: 'home',
  isUnlocked: false,
  isReady: false,
  isBooted: false
};

const slice = createSlice({
  name: 'global',
  initialState,
  reducers: {
    // eslint-disable-next-line no-unused-vars
    reset(_state) {
      return initialState;
    },
    update(
      state,
      action: {
        payload: {
          tab?: TabOption;
          isUnlocked?: boolean;
          isReady?: boolean;
          isBooted?: boolean;
        };
      }
    ) {
      const { payload } = action;
      state = Object.assign({}, state, payload);
      return state;
    }
  },
  extraReducers: (builder) => {
    // eslint-disable-next-line no-unused-vars
    builder.addCase(updateVersion, (_state) => {
      // todo
    });
  }
});

export const globalActions = slice.actions;
export default slice.reducer;
