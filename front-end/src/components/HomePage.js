import { useNavigate } from "react-router-dom";

const HomePage = () => {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate("/login");
  };

  return (
    <div className="home-page">
      <img
        src={`${process.env.PUBLIC_URL}/icon.jpeg`}
        alt="Icon"
        className="img-container"
      />
      <h1>NoteLink</h1>
      <button onClick={handleClick}>Sign In</button>
      <h2>The best place for all your notes.</h2>
    </div>
  );
};

export default HomePage;
