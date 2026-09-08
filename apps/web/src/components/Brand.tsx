import { FOIL_LOGO_PATHS, FOIL_LOGO_VIEWBOX } from '../assets/brand/geometry';

/** GPT Image artwork converted to paths; stays sharp and works in offline exports. */
export function Brand() {
  return (
    <div className="brand" role="img" aria-label="Foil">
      <svg className="brand-logo" viewBox={FOIL_LOGO_VIEWBOX} width="74" height="32" fill="currentColor" aria-hidden="true" focusable="false">
        {FOIL_LOGO_PATHS.map((path, index) => <path key={index} d={path.d} transform={path.transform} />)}
      </svg>
    </div>
  );
}
