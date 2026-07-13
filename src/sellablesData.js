import { sellablesIcons as icon } from './assets/assets.js';

export const SHELL_ITEMS = [
  { name: 'Tro', price: 3, image: icon.tro },
  { name: 'Aero', price: 3, image: icon.aero },
  { name: 'Sand Dollar', price: 5, image: icon.sandDollar },
  { name: 'Scallop', price: 5, image: icon.scallop },
  { name: 'Starfish', price: 7, image: icon.star },
];

export const SELLABLE_ITEMS = SHELL_ITEMS;
export const SELLABLE_BY_NAME = new Map(SHELL_ITEMS.map((item) => [item.name, item]));
