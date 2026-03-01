INSERT INTO users (email, password_hash, display_name, role)
VALUES
  ('admin@globalt20.com', '$2a$10$uyfIprkdsXSEVnpbVnJH0eNXxoi8LBdLCYOKOzLaxcULrBnizw/We', 'Commissioner', 'admin'),
  ('demo@globalt20.com', '$2a$10$/eXMkyrl6WbVXFWx3lfVxOG.FCfDz.57Rp1PVoCQY17mvfZs0kXj2', 'Demo Manager', 'user');

INSERT INTO transfer_feed (season_id, action_type, message)
VALUES (NULL, 'SEASON_NOTE', 'Global city catalog loaded. Claim any city to generate your 52-team, four-league career pyramid.');
