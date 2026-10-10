/** `ids` with `id` moved to where `target` is: after it when moving down, before it when moving up. */
export function moveTo(ids: number[], id: number, target: number): number[] {
  const rest = ids.filter((other) => other !== id)
  rest.splice(ids.indexOf(target), 0, id)
  return rest
}
