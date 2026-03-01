export default function CityMap({ cities }) {
  if (!cities?.length) {
    return <div className="empty-state">No cities available.</div>;
  }

  return (
    <div className="city-map-grid">
      {cities.slice(0, 18).map((city) => (
        <div className="city-dot-card" key={`${city.name}-${city.country}`}>
          <p>{city.name}</p>
          <span>{city.country}</span>
          <small>
            {Number(city.latitude).toFixed(2)}, {Number(city.longitude).toFixed(2)}
          </small>
        </div>
      ))}
    </div>
  );
}
