import { expect, test } from 'vitest'
import { moveTo } from './reorder'

test('moveTo puts the row where the target is', () => {
  expect(moveTo([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]) // down: lands after the target
  expect(moveTo([1, 2, 3, 4], 1, 4)).toEqual([2, 3, 4, 1])
  expect(moveTo([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]) // up: lands before the target
  expect(moveTo([1, 2, 3, 4], 4, 1)).toEqual([4, 1, 2, 3])
  expect(moveTo([1, 2], 2, 2)).toEqual([1, 2])
})
