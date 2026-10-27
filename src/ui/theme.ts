export const colors = {
  background: '#161412',
  surface: '#231E19',
  surfaceRaised: '#302922',
  surfaceSunken: '#1A1613',
  border: '#3D342A',
  text: '#FAF6F0',
  textMuted: '#B0A596',
  accent: '#EFA838',
  accentInk: '#1C1204',
  accentSoft: 'rgba(239, 168, 56, 0.16)',
  danger: '#F06E5B',
  /** Stones whose fate is open: violet, the wood's opposite and neither good nor bad, so it never sinks into the board. */
  open: '#B58CFF',
  /** A family member who has Play online open now. */
  online: '#7CC77F',
  /** A rank gone up after a game. */
  rankUp: '#7CC77F',
  /** The dashed ring of a suggested move, on the board and in the advice: green, so it stands out from the warning marks. */
  idea: '#7CC77F',
  /** Behind the idea the player tapped in the advice, so the selected row reads as the same green idea. */
  ideaSoft: 'rgba(124, 199, 127, 0.16)',
  woodLight: '#E8BC7C',
  woodDark: '#C38D4C',
  woodEdge: '#8F6130',
  grid: '#4A3117',
  coord: '#7C5631',
  /** Labels over the board that belong to neither player: amber, so they never read as a black or white stone's. */
  note: '#EFA838',
  noteInk: '#1C1204',
  noteEdge: 'rgba(28, 18, 4, 0.45)',
  /** Territory squares, in the colour of the player who owns them. */
  territoryBlack: '#1E1C1A',
  territoryWhite: '#FBF8F2',
};

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
  title: 'ShipporiMincho_800ExtraBold',
};

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 };

/** The colour of a player's territory squares. */
export const territoryTint = (c: 'black' | 'white') => (c === 'black' ? colors.territoryBlack : colors.territoryWhite);
