// All geometry is in Electron DIP coordinates, including negative-origin displays.
function sideAt(bounds, pet, area) {
  if (bounds.x + pet.x <= area.x + 12) return 'left';
  if (bounds.x + pet.x + pet.width >= area.x + area.width - 12) return 'right';
  return null;
}
function dockBounds(bounds, pet, area, side) {
  // Align the peeking sprite's invisible hand-grip edge with the work-area edge.
  const inset = pet.width * 0.12;
  const x = side === 'left' ? area.x - pet.x - inset : area.x + area.width - pet.x - pet.width + inset;
  const top = Math.max(area.y, Math.min(bounds.y + pet.y, area.y + area.height - pet.height));
  return { ...bounds, x: Math.round(x), y: Math.round(top - pet.y) };
}
function hintAt(bounds, pet, area) {
  const left = bounds.x + pet.x - area.x;
  const right = area.x + area.width - bounds.x - pet.x - pet.width;
  const side = left <= 60 ? 'left' : right <= 60 ? 'right' : null;
  if (!side) {
    const gap = area.y + area.height - (bounds.y + pet.y + pet.height * .84);
    const snap = Math.max(48, pet.height * .16 + 16);
    const reach = snap + 32;
    if (gap < -1 || gap > reach) return null;
    return {side:'bottom', ready:gap <= snap, strength:Math.max(.25, Math.min(1, 1 - gap / reach * .75))};
  }
  const distance = side === 'left' ? left : right;
  const strength = Math.round((0.25 + 0.75 * Math.max(0, Math.min(1, (60 - distance) / 48))) * 100) / 100;
  return { side, ready: sideAt(bounds, pet, area) === side, strength };
}
function clampPetBounds(bounds, pet, area) {
  const margin = 4;
  const x = Math.max(area.x + margin - pet.x, Math.min(bounds.x, area.x + area.width - margin - pet.x - pet.width));
  const y = Math.max(area.y + margin - pet.y, Math.min(bounds.y, area.y + area.height - margin - pet.y - pet.height));
  return {...bounds, x: Math.round(x), y: Math.round(y)};
}
module.exports = { sideAt, dockBounds, hintAt, clampPetBounds };
