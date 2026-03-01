import { randomInt } from '../utils/gameMath.js';

const NAME_PROFILES = {
  SOUTH_ASIA: {
    first: [
      'Aarav', 'Vihaan', 'Kabir', 'Ishaan', 'Rohan', 'Kunal', 'Arjun', 'Dev', 'Yash', 'Aditya',
      'Pranav', 'Rahul', 'Nikhil', 'Manav', 'Dhruv', 'Siddharth', 'Abhishek', 'Tilak', 'Aaryan', 'Shivam'
    ],
    last: [
      'Sharma', 'Patel', 'Nair', 'Iyer', 'Reddy', 'Gupta', 'Verma', 'Kapoor', 'Jain', 'Singh',
      'Bhat', 'Desai', 'Yadav', 'Mishra', 'Kohli', 'Agarwal', 'Chawla', 'Malhotra', 'Choudhary', 'Pillai'
    ]
  },
  PAK_AFGHAN: {
    first: [
      'Ali', 'Hassan', 'Usman', 'Haider', 'Aamir', 'Babar', 'Imran', 'Saad', 'Fahad', 'Hamza',
      'Ahmed', 'Talha', 'Iftikhar', 'Naveed', 'Danish', 'Sameer', 'Raza', 'Farhan', 'Zain', 'Shahzaib'
    ],
    last: [
      'Khan', 'Akram', 'Ahmed', 'Raza', 'Malik', 'Nawaz', 'Iqbal', 'Qureshi', 'Aslam', 'Siddiqui',
      'Afridi', 'Butt', 'Dar', 'Mirza', 'Gul', 'Hashmi', 'Khattak', 'Jan', 'Yousaf', 'Shinwari'
    ]
  },
  SRI_LANKA: {
    first: [
      'Nuwan', 'Kusal', 'Dasun', 'Pathum', 'Dhananjaya', 'Charith', 'Kasun', 'Maheesh', 'Dushmantha', 'Lakshan',
      'Avishka', 'Chamika', 'Niroshan', 'Dimuth', 'Angelo', 'Bhanuka', 'Vishwa', 'Ashen', 'Sahan', 'Kavindu'
    ],
    last: [
      'Perera', 'Silva', 'Mendis', 'Fernando', 'Bandara', 'Jayasuriya', 'Gunaratne', 'Madushanka', 'Rajapaksa', 'Kumara',
      'Karunaratne', 'Lakmal', 'Herath', 'Samarawickrama', 'Nissanka', 'Dananjaya', 'de Alwis', 'Senanayake', 'Ranatunga', 'Wijesinghe'
    ]
  },
  ARABIC: {
    first: [
      'Omar', 'Zayed', 'Khalid', 'Saif', 'Hamdan', 'Ayaan', 'Rayan', 'Faris', 'Tariq', 'Nasser',
      'Faisal', 'Rashid', 'Hadi', 'Karim', 'Bilal', 'Yahya', 'Salman', 'Adnan', 'Majid', 'Taha'
    ],
    last: [
      'Al Nuaimi', 'Al Mansoori', 'Al Shehhi', 'Al Ameri', 'Al Hammadi', 'Al Mazrouei', 'Al Kaabi', 'Al Marri', 'Al Suwaidi', 'Al Falahi',
      'Al Farsi', 'Al Balushi', 'Al Harbi', 'Al Qahtani', 'Al Rashid', 'Al Habsi', 'Al Khalifa', 'Al Sabah', 'Al Thani', 'Al Said'
    ]
  },
  PERSIAN_CENTRAL: {
    first: [
      'Arman', 'Kian', 'Dariush', 'Reza', 'Farhad', 'Navid', 'Parviz', 'Mehdi', 'Azamat', 'Timur',
      'Bekzod', 'Rustam', 'Davron', 'Murad', 'Otabek', 'Aziz', 'Nurlan', 'Sanzhar', 'Alisher', 'Eldar'
    ],
    last: [
      'Rahimi', 'Ahmadi', 'Hosseini', 'Karimi', 'Moradi', 'Farhadi', 'Kazemi', 'Nouri', 'Yuldashev', 'Tursunov',
      'Iskandarov', 'Sadykov', 'Aliyev', 'Mammadov', 'Bekov', 'Nazarov', 'Karimov', 'Rasulov', 'Ergashev', 'Ibragimov'
    ]
  },
  EAST_ASIA: {
    first: [
      'Haruto', 'Yuto', 'Sota', 'Ren', 'Yuki', 'Kaito', 'Riku', 'Minato', 'Taiga', 'Itsuki',
      'Minho', 'Jihoon', 'Taeyang', 'Junseo', 'Wei', 'Jun', 'Hao', 'Chen', 'Jian', 'Ming'
    ],
    last: [
      'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Nakamura', 'Kobayashi', 'Kato', 'Yamamoto',
      'Kim', 'Park', 'Lee', 'Choi', 'Kang', 'Chen', 'Lin', 'Wang', 'Zhang', 'Liu'
    ]
  },
  SOUTH_EAST_ASIA: {
    first: [
      'An', 'Minh', 'Thanh', 'Quang', 'Tuan', 'Huy', 'Rizky', 'Dimas', 'Bagas', 'Fajar',
      'Arif', 'Nabil', 'Surya', 'Adi', 'Firdaus', 'Nattapong', 'Krit', 'Sokha', 'Vannak', 'Prasetyo'
    ],
    last: [
      'Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Lim', 'Tan', 'Ong', 'Wong', 'Goh',
      'Rahman', 'Hassan', 'Abdullah', 'Ismail', 'Wijaya', 'Saputra', 'Santoso', 'Prasetyo', 'Putra', 'Suryanto'
    ]
  },
  ANGLO: {
    first: [
      'Oliver', 'Harry', 'Noah', 'Liam', 'Ethan', 'George', 'Mason', 'Ben', 'Sam', 'Jack',
      'Cooper', 'Mitchell', 'Bailey', 'Luke', 'Flynn', 'Ryan', 'Joshua', 'Corey', 'Hudson', 'Caleb'
    ],
    last: [
      'Smith', 'Taylor', 'Walker', 'Wilson', 'Brown', 'Baker', 'Evans', 'Clark', 'Hughes', 'Hall',
      'Johnson', 'Miller', 'Davis', 'Anderson', 'Thompson', 'Moore', 'White', 'Harris', 'Turner', 'Parker'
    ]
  },
  WEST_EUROPE: {
    first: [
      'Lucas', 'Jules', 'Hugo', 'Mathis', 'Nathan', 'Eliot', 'Leo', 'Enzo', 'Lukas', 'Felix',
      'Max', 'Paul', 'Jonas', 'Leon', 'Finn', 'Emil', 'Lorenzo', 'Matteo', 'Andrea', 'Ruben'
    ],
    last: [
      'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Petit', 'Moreau', 'Laurent', 'Simon', 'Michel',
      'Muller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Rossi', 'Bianchi', 'Romano', 'de Jong', 'de Vries'
    ]
  },
  IBERIAN_LATAM: {
    first: [
      'Mateo', 'Hugo', 'Leo', 'Pablo', 'Diego', 'Adrian', 'Lucas', 'Martin', 'Nicolas', 'Santiago',
      'Thiago', 'Bruno', 'Rafael', 'Tomas', 'Joaquin', 'Emiliano', 'Andres', 'Felipe', 'Ignacio', 'Cesar'
    ],
    last: [
      'Garcia', 'Martinez', 'Lopez', 'Sanchez', 'Perez', 'Gomez', 'Ruiz', 'Fernandez', 'Diaz', 'Moreno',
      'Silva', 'Costa', 'Pereira', 'Alves', 'Ramos', 'Torres', 'Herrera', 'Castro', 'Mendoza', 'Vega'
    ]
  },
  SLAVIC: {
    first: [
      'Ivan', 'Dmitri', 'Alexei', 'Nikolai', 'Sergei', 'Mikhail', 'Andrei', 'Pavel', 'Viktor', 'Kirill',
      'Oleg', 'Roman', 'Denis', 'Artem', 'Yaroslav', 'Maksim', 'Piotr', 'Mateusz', 'Tomasz', 'Luka'
    ],
    last: [
      'Ivanov', 'Petrov', 'Sidorov', 'Smirnov', 'Volkov', 'Orlov', 'Fedorov', 'Kuznetsov', 'Popov', 'Morozov',
      'Kowalski', 'Nowak', 'Wisniewski', 'Zielinski', 'Novak', 'Horvat', 'Jovanovic', 'Markovic', 'Ilic', 'Petrovic'
    ]
  },
  AFRICAN: {
    first: [
      'Thabo', 'Kagiso', 'Aiden', 'Ruan', 'Lungi', 'Keegan', 'Sipho', 'Themba', 'Tinashe', 'Tendai',
      'Kofi', 'Kwame', 'Chinedu', 'Emeka', 'Musa', 'Idris', 'Brian', 'Kevin', 'Victor', 'Moses'
    ],
    last: [
      'van der Merwe', 'de Kock', 'Pretorius', 'Mahlangu', 'Petersen', 'Naidoo', 'Botha', 'Steyn', 'Mokoena', 'Abrahams',
      'Otieno', 'Ochieng', 'Mwangi', 'Kamau', 'Kiptoo', 'Mutiso', 'Njoroge', 'Mensah', 'Okafor', 'Balogun'
    ]
  },
  CARIBBEAN: {
    first: [
      'Shai', 'Rovman', 'Shimron', 'Akeal', 'Andre', 'Jason', 'Romario', 'Keon', 'Sherfane', 'Brandon',
      'Alzarri', 'Kraigg', 'Odean', 'Roston', 'Fabian', 'Nicholas', 'Daren', 'Marlon', 'Devon', 'Sunil'
    ],
    last: [
      'Holder', 'Pooran', 'Hope', 'Joseph', 'King', 'Motie', 'Edwards', 'Cottrell', 'Gabriel', 'Carty',
      'Brathwaite', 'Narine', 'Gayle', 'Pollard', 'Bravo', 'Taylor', 'Lewis', 'Russell', 'Ramdin', 'Seales'
    ]
  },
  PACIFIC: {
    first: [
      'Tane', 'Ariki', 'Mana', 'Tama', 'Pita', 'Sione', 'Kalani', 'Latu', 'Semisi', 'Jone',
      'Tevita', 'Iosefo', 'Matiu', 'Niko', 'Kauri', 'Rangi', 'Tui', 'Fetu', 'Maika', 'Tavita'
    ],
    last: [
      'Fale', 'Tuipulotu', 'Vunipola', 'Maafu', 'Manu', 'Latu', 'Fifita', 'Taufa', 'Matai', 'Sio',
      'Tui', 'Faletau', 'Moala', 'Toloa', 'Malietoa', 'Tavake', 'Aho', 'Vakacegu', 'Niko', 'Fotu'
    ]
  },
  GLOBAL: {
    first: [
      'Noah', 'Liam', 'Arjun', 'Jay', 'Theo', 'Ryan', 'Aiden', 'Milan', 'Kai', 'Rohan',
      'Lucas', 'Mateo', 'Kaito', 'Ali', 'Omar', 'Tane', 'Thabo', 'Ivan', 'Bruno', 'Minh'
    ],
    last: [
      'Singh', 'Khan', 'Patel', 'Smith', 'Brown', 'Lee', 'Taylor', 'Davis', 'Miller', 'Wilson',
      'Garcia', 'Kim', 'Rahman', 'Ivanov', 'Njoroge', 'Holder', 'Perera', 'Rossi', 'Nguyen', 'Al Mansoori'
    ]
  }
};

const PROFILE_NAME_EXPANSIONS = {
  SOUTH_ASIA: {
    first: [
      'Anirudh', 'Varun', 'Saurabh', 'Harshit', 'Kartik', 'Vivek', 'Akash', 'Neel', 'Rajat', 'Aman',
      'Piyush', 'Mayank', 'Shreyas', 'Ravindra', 'Prithvi', 'Atharva', 'Lakshay', 'Tushar', 'Gaurav', 'Naveen',
      'Hemant', 'Deepak', 'Parth', 'Chirag', 'Samar'
    ],
    last: [
      'Kulkarni', 'Chatterjee', 'Banerjee', 'Mukherjee', 'Das', 'Bose', 'Menon', 'Krishnan', 'Subramanian', 'Narayanan',
      'Srivastava', 'Tripathi', 'Dubey', 'Saxena', 'Tiwari', 'Pandey', 'Bhardwaj', 'Chauhan', 'Shetty', 'Rao',
      'Joshi', 'Thakur', 'Sethi', 'Goyal', 'Anand'
    ]
  },
  PAK_AFGHAN: {
    first: [
      'Zubair', 'Salman', 'Shadab', 'Shoaib', 'Shahid', 'Abrar', 'Junaid', 'Faizan', 'Kashif', 'Waqas',
      'Hamid', 'Tariq', 'Haris', 'Asad', 'Noman', 'Bilawal', 'Ehsan', 'Adil', 'Kamran', 'Muneeb',
      'Sheraz', 'Yasir', 'Jawad', 'Faraz', 'Nabeel'
    ],
    last: [
      'Shah', 'Anwar', 'Masood', 'Farooq', 'Zaman', 'Khalid', 'Yaqoob', 'Aziz', 'Hameed', 'Nadeem',
      'Ghaffar', 'Rehman', 'Basit', 'Gulzar', 'Shafiq', 'Rauf', 'Rabbani', 'Wardak', 'Safi', 'Khilji',
      'Durrani', 'Noorzai', 'Laghmani', 'Achakzai', 'Shinwari'
    ]
  },
  SRI_LANKA: {
    first: [
      'Wanindu', 'Lahiru', 'Isuru', 'Asitha', 'Dilshan', 'Thisara', 'Shehan', 'Janith', 'Sandun', 'Roshen',
      'Pavan', 'Dinura', 'Ravindu', 'Sadeera', 'Amila', 'Tharindu', 'Milinda', 'Heshan', 'Nipun', 'Prabath'
    ],
    last: [
      'Pathirana', 'Chameera', 'Wickramasinghe', 'Kulasekara', 'Mathews', 'Jayawardene', 'Chandimal', 'Thirimanne', 'Vaas', 'Muralitharan',
      'Weerakoon', 'Ponnamperuma', 'Ranasinghe', 'Karunathilaka', 'Liyanage', 'Ekanayake', 'Hewage', 'Wijeratne', 'Peiris', 'Samarasinghe'
    ]
  },
  ARABIC: {
    first: [
      'Hamad', 'Marwan', 'Khaled', 'Adel', 'Yousuf', 'Ibrahim', 'Abdulrahman', 'Abdulaziz', 'Saeed', 'Mahmoud',
      'Sami', 'Ziad', 'Ammar', 'Hisham', 'Fawaz', 'Talal', 'Mansour', 'Bader', 'Sultan', 'Anas'
    ],
    last: [
      'Al Maktoum', 'Al Otaiba', 'Al Tayer', 'Al Fardan', 'Al Hashmi', 'Al Ketbi', 'Al Ghamdi', 'Al Mutairi', 'Al Dosari', 'Al Zahrani',
      'Al Harthi', 'Al Yami', 'Al Mheiri', 'Al Mulla', 'Al Qasimi', 'Al Yafei', 'Al Muhairi', 'Al Busaidi', 'Al Rawahi', 'Al Jabri'
    ]
  },
  PERSIAN_CENTRAL: {
    first: [
      'Hamidreza', 'Pouya', 'Kourosh', 'Shahram', 'Omid', 'Hamed', 'Farzad', 'Kamyar', 'Sina', 'Mehran',
      'Arash', 'Shayan', 'Peyman', 'Roozbeh', 'Jamshid', 'Behzad', 'Erfan', 'Samad', 'Dilshod', 'Ulugbek'
    ],
    last: [
      'Mohammadi', 'Ebrahimi', 'Jafari', 'Davoodi', 'Fallah', 'Pahlavi', 'Shakeri', 'Taheri', 'Khademi', 'Samadi',
      'Norouzi', 'Ghanbari', 'Bagheri', 'Sharifov', 'Nematov', 'Kurbanov', 'Tadjiev', 'Ermatov', 'Saparov', 'Yusupov'
    ]
  },
  EAST_ASIA: {
    first: [
      'Daichi', 'Shota', 'Keita', 'Ryota', 'Takumi', 'Naoki', 'Kazuki', 'Yuya', 'Shohei', 'Kota',
      'Seungmin', 'Hyunwoo', 'Donghyun', 'Jisoo', 'Jaemin', 'Yifan', 'Zhiyu', 'Tian', 'Jiahao', 'Yicheng'
    ],
    last: [
      'Yoshida', 'Matsumoto', 'Inoue', 'Shimizu', 'Hayashi', 'Saito', 'Yamada', 'Arai', 'Fujimoto', 'Ogawa',
      'Jeong', 'Seo', 'Han', 'Kwon', 'Cho', 'Xu', 'Sun', 'Gao', 'He', 'Huang'
    ]
  },
  SOUTH_EAST_ASIA: {
    first: [
      'Phuc', 'Duc', 'Khoa', 'Long', 'Hai', 'Nam', 'Wira', 'Bima', 'Arya', 'Joko',
      'Eko', 'Putu', 'Chaiwat', 'Anan', 'Somchai', 'Phan', 'Dara', 'Rithy', 'Hakim', 'Zulkifli'
    ],
    last: [
      'Widodo', 'Nugroho', 'Kurniawan', 'Pramana', 'Setiawan', 'Hartono', 'Suharto', 'Boon', 'Teo', 'Yeo',
      'Loh', 'Chew', 'Mahathir', 'Harun', 'Chansiri', 'Suksawat', 'Vong', 'Keo', 'Chanthavong', 'Chhay'
    ]
  },
  ANGLO: {
    first: [
      'James', 'William', 'Thomas', 'Charles', 'Henry', 'Edward', 'Alexander', 'Daniel', 'Matthew', 'Joseph',
      'Cameron', 'Dylan', 'Nathan', 'Isaac', 'Owen', 'Levi', 'Carter', 'Blake', 'Jordan', 'Colin'
    ],
    last: [
      'Richardson', 'Cooper', 'Collins', 'Stewart', 'Reed', 'Ward', 'Bennett', 'Jenkins', 'Foster', 'Price',
      'Cox', 'Barnes', 'Holmes', 'Knight', 'Simpson', 'Ellis', 'Dean', 'Griffin', 'Marshall', 'Morgan'
    ]
  },
  WEST_EUROPE: {
    first: [
      'Antoine', 'Baptiste', 'Remy', 'Axel', 'Damien', 'Pierre', 'Valentin', 'Sebastian', 'Niklas', 'Tobias',
      'Moritz', 'Julian', 'Fabio', 'Marco', 'Pietro', 'Davide', 'Stefan', 'Henrik', 'Casper', 'Mads'
    ],
    last: [
      'Lefevre', 'Fontaine', 'Giraud', 'Mercier', 'Dupont', 'Klein', 'Braun', 'Vogel', 'Kruger', 'Zimmermann',
      'Lombardi', 'Conti', 'De Luca', 'Santoro', 'van Dijk', 'van den Berg', 'van Leeuwen', 'Janssen', 'Schouten', 'Verhoeven'
    ]
  },
  IBERIAN_LATAM: {
    first: [
      'Javier', 'Alejandro', 'Ricardo', 'Daniel', 'Manuel', 'Miguel', 'Alvaro', 'Sergio', 'Raul', 'Carlos',
      'Juan', 'Pedro', 'Esteban', 'Matias', 'Damian', 'Franco', 'Gonzalo', 'Ramiro', 'Rodrigo', 'Vicente',
      'Fabian', 'Renato', 'Mauro', 'Cristian', 'Eduardo'
    ],
    last: [
      'Navarro', 'Campos', 'Aguilar', 'Medina', 'Cabrera', 'Pacheco', 'Fuentes', 'Salazar', 'Rojas', 'Duarte',
      'Araujo', 'Farias', 'Contreras', 'Mendez', 'Valdez', 'Benitez', 'Quintana', 'Ponce', 'Pizarro', 'Arce',
      'Acosta', 'Romero', 'Ortega', 'Molina', 'Suarez'
    ]
  },
  SLAVIC: {
    first: [
      'Boris', 'Stanislav', 'Vladislav', 'Gennady', 'Konstantin', 'Lev', 'Ilya', 'Marcin', 'Jakub', 'Kacper',
      'Dominik', 'Filip', 'Krzysztof', 'Zoran', 'Dejan', 'Nenad', 'Milos', 'Branislav', 'Davor', 'Goran'
    ],
    last: [
      'Romanov', 'Sorokin', 'Baranov', 'Belov', 'Nikitin', 'Denisov', 'Pavlov', 'Wojcik', 'Kaminski', 'Lewandowski',
      'Dabrowski', 'Majewski', 'Kravchenko', 'Bondarenko', 'Shevchenko', 'Rybak', 'Vukovic', 'Stojanovic', 'Kovacevic', 'Mihajlovic'
    ]
  },
  AFRICAN: {
    first: [
      'Siphesihle', 'Bongani', 'Mpho', 'Kabelo', 'Lerato', 'Sibusiso', 'Andile', 'Simphiwe', 'Tawanda', 'Farai',
      'Chipo', 'Tapiwa', 'Ayo', 'Tunde', 'Femi', 'Chukwudi', 'Ifeanyi', 'Nuru', 'Baraka', 'Hamisi'
    ],
    last: [
      'Khumalo', 'Dlamini', 'Nkosi', 'Mthembu', 'Gumede', 'Chirwa', 'Banda', 'Phiri', 'Moyo', 'Sibanda',
      'Adeyemi', 'Lawal', 'Ojo', 'Adebayo', 'Muriuki', 'Wanjiku', 'Kipruto', 'Cheruiyot', 'Ouma', 'Ndlovu'
    ]
  },
  CARIBBEAN: {
    first: [
      'Kieron', 'Shivnarine', 'Dwayne', 'Chris', 'Kemar', 'Kesrick', 'Obed', 'Raymon', 'Lendl', 'Denesh',
      'Jermaine', 'Leon', 'Tariq', 'Jevon', 'Rahkeem', 'Jomel', 'Alick', 'Oshane', 'Kenroy', 'Jerell'
    ],
    last: [
      'Charles', 'Cornwall', 'Roach', 'Ramnarine', 'Ganga', 'Chanderpaul', 'Ramroop', 'Blackwood', 'Hodge', 'Bonner',
      'Forde', 'Primus', 'Greenidge', 'Ambrose', 'Walsh', 'Bishop', 'Samuels', 'Hinds', 'Nedd', 'Browne'
    ]
  },
  PACIFIC: {
    first: [
      'Apisalome', 'Isikeli', 'Waisale', 'Peceli', 'Viliami', 'Solomone', 'Sefanaia', 'Leka', 'Fono', 'Iakopo',
      'Taniela', 'Siosiua', 'Inoke', 'Joeli', 'Peni', 'Manoa', 'Setareki', 'Josua', 'Seta', 'Ratu'
    ],
    last: [
      'Rabuka', 'Naisarani', 'Nadolo', 'Rokoduguni', 'Nayacalevu', 'Waqa', 'Kolinisau', 'Tuisova', 'Matanavou', 'Vakatawa',
      'Taumoepeau', 'Moala', 'Koroibete', 'Nakarawa', 'Raiwalui', 'Tuilagi', 'Sopoaga', 'Savea', 'Ioane', 'Tuivasa'
    ]
  },
  GLOBAL: {
    first: [
      'Ari', 'Zane', 'Mika', 'Rico', 'Nolan', 'Kian', 'Soren', 'Amir', 'Farid', 'Ravi',
      'Tobin', 'Luca', 'Enrique', 'Marek', 'Arlo', 'Kenji', 'Rafael', 'Dario', 'Ibrahim', 'Samir'
    ],
    last: [
      'Kerr', 'Pinto', 'Malik', 'Ilyas', 'Khatri', 'Yoon', 'Navin', 'Borges', 'Fischer', 'Kadir',
      'Petrescu', 'Santos', 'Rahimi', 'Mori', 'Khanal', 'Bokhari', 'Aoki', 'Volkan', 'Okoye', 'Delgado'
    ]
  }
};

const COUNTRY_ALIASES = {
  'United States': 'USA',
  'United States of America': 'USA',
  'United Kingdom': 'UK',
  'Great Britain': 'UK',
  'United Arab Emirates': 'UAE',
  "Cote d'Ivoire": 'Ivory Coast',
  'Czech Republic': 'Czechia',
  'Russian Federation': 'Russia',
  'Viet Nam': 'Vietnam',
  'Korea, Republic of': 'South Korea',
  'Korea, Democratic People\'s Republic of': 'North Korea'
};

const COUNTRY_PROFILE_MAP = {
  india: 'SOUTH_ASIA',
  nepal: 'SOUTH_ASIA',
  bhutan: 'SOUTH_ASIA',
  bangladesh: 'SOUTH_ASIA',
  pakistan: 'PAK_AFGHAN',
  afghanistan: 'PAK_AFGHAN',
  'sri lanka': 'SRI_LANKA',

  uae: 'ARABIC',
  'saudi arabia': 'ARABIC',
  qatar: 'ARABIC',
  bahrain: 'ARABIC',
  oman: 'ARABIC',
  kuwait: 'ARABIC',
  jordan: 'ARABIC',
  iraq: 'ARABIC',
  syria: 'ARABIC',
  yemen: 'ARABIC',
  lebanon: 'ARABIC',
  palestine: 'ARABIC',
  egypt: 'ARABIC',
  algeria: 'ARABIC',
  morocco: 'ARABIC',
  tunisia: 'ARABIC',
  libya: 'ARABIC',

  iran: 'PERSIAN_CENTRAL',
  azerbaijan: 'PERSIAN_CENTRAL',
  kazakhstan: 'PERSIAN_CENTRAL',
  uzbekistan: 'PERSIAN_CENTRAL',
  turkmenistan: 'PERSIAN_CENTRAL',
  kyrgyzstan: 'PERSIAN_CENTRAL',
  tajikistan: 'PERSIAN_CENTRAL',
  turkey: 'PERSIAN_CENTRAL',
  georgia: 'PERSIAN_CENTRAL',
  armenia: 'PERSIAN_CENTRAL',

  japan: 'EAST_ASIA',
  china: 'EAST_ASIA',
  taiwan: 'EAST_ASIA',
  mongolia: 'EAST_ASIA',
  'south korea': 'EAST_ASIA',
  'north korea': 'EAST_ASIA',
  'hong kong': 'EAST_ASIA',
  macao: 'EAST_ASIA',
  macau: 'EAST_ASIA',

  singapore: 'SOUTH_EAST_ASIA',
  malaysia: 'SOUTH_EAST_ASIA',
  indonesia: 'SOUTH_EAST_ASIA',
  thailand: 'SOUTH_EAST_ASIA',
  vietnam: 'SOUTH_EAST_ASIA',
  cambodia: 'SOUTH_EAST_ASIA',
  laos: 'SOUTH_EAST_ASIA',
  myanmar: 'SOUTH_EAST_ASIA',
  philippines: 'SOUTH_EAST_ASIA',
  brunei: 'SOUTH_EAST_ASIA',
  'timor leste': 'SOUTH_EAST_ASIA',

  usa: 'ANGLO',
  'united states minor outlying islands': 'ANGLO',
  canada: 'ANGLO',
  uk: 'ANGLO',
  ireland: 'ANGLO',
  australia: 'ANGLO',
  'new zealand': 'ANGLO',

  france: 'WEST_EUROPE',
  germany: 'WEST_EUROPE',
  italy: 'WEST_EUROPE',
  netherlands: 'WEST_EUROPE',
  belgium: 'WEST_EUROPE',
  switzerland: 'WEST_EUROPE',
  austria: 'WEST_EUROPE',
  denmark: 'WEST_EUROPE',
  sweden: 'WEST_EUROPE',
  norway: 'WEST_EUROPE',
  finland: 'WEST_EUROPE',
  iceland: 'WEST_EUROPE',
  luxembourg: 'WEST_EUROPE',

  spain: 'IBERIAN_LATAM',
  portugal: 'IBERIAN_LATAM',
  mexico: 'IBERIAN_LATAM',
  argentina: 'IBERIAN_LATAM',
  brazil: 'IBERIAN_LATAM',
  chile: 'IBERIAN_LATAM',
  colombia: 'IBERIAN_LATAM',
  peru: 'IBERIAN_LATAM',
  bolivia: 'IBERIAN_LATAM',
  paraguay: 'IBERIAN_LATAM',
  uruguay: 'IBERIAN_LATAM',
  venezuela: 'IBERIAN_LATAM',
  ecuador: 'IBERIAN_LATAM',
  guatemala: 'IBERIAN_LATAM',
  honduras: 'IBERIAN_LATAM',
  nicaragua: 'IBERIAN_LATAM',
  panama: 'IBERIAN_LATAM',
  'costa rica': 'IBERIAN_LATAM',
  'el salvador': 'IBERIAN_LATAM',
  'dominican republic': 'IBERIAN_LATAM',
  cuba: 'IBERIAN_LATAM',
  'puerto rico': 'IBERIAN_LATAM',

  russia: 'SLAVIC',
  ukraine: 'SLAVIC',
  belarus: 'SLAVIC',
  poland: 'SLAVIC',
  czechia: 'SLAVIC',
  slovakia: 'SLAVIC',
  romania: 'SLAVIC',
  bulgaria: 'SLAVIC',
  serbia: 'SLAVIC',
  croatia: 'SLAVIC',
  slovenia: 'SLAVIC',
  montenegro: 'SLAVIC',
  albania: 'SLAVIC',
  kosovo: 'SLAVIC',
  moldova: 'SLAVIC',
  latvia: 'SLAVIC',
  lithuania: 'SLAVIC',
  estonia: 'SLAVIC',

  'south africa': 'AFRICAN',
  namibia: 'AFRICAN',
  botswana: 'AFRICAN',
  zimbabwe: 'AFRICAN',
  zambia: 'AFRICAN',
  mozambique: 'AFRICAN',
  kenya: 'AFRICAN',
  uganda: 'AFRICAN',
  tanzania: 'AFRICAN',
  nigeria: 'AFRICAN',
  ghana: 'AFRICAN',
  cameroon: 'AFRICAN',
  ethiopia: 'AFRICAN',
  rwanda: 'AFRICAN',
  senegal: 'AFRICAN',
  'ivory coast': 'AFRICAN',
  angola: 'AFRICAN',
  malawi: 'AFRICAN',

  jamaica: 'CARIBBEAN',
  barbados: 'CARIBBEAN',
  'trinidad and tobago': 'CARIBBEAN',
  guyana: 'CARIBBEAN',
  'antigua and barbuda': 'CARIBBEAN',
  dominica: 'CARIBBEAN',
  grenada: 'CARIBBEAN',
  'saint lucia': 'CARIBBEAN',
  'st lucia': 'CARIBBEAN',
  'saint vincent and the grenadines': 'CARIBBEAN',
  'st vincent and the grenadines': 'CARIBBEAN',
  'saint kitts and nevis': 'CARIBBEAN',
  'st kitts and nevis': 'CARIBBEAN',
  bahamas: 'CARIBBEAN',
  belize: 'CARIBBEAN',
  suriname: 'CARIBBEAN',

  fiji: 'PACIFIC',
  samoa: 'PACIFIC',
  tonga: 'PACIFIC',
  vanuatu: 'PACIFIC',
  palau: 'PACIFIC',
  kiribati: 'PACIFIC',
  tuvalu: 'PACIFIC',
  nauru: 'PACIFIC',
  niue: 'PACIFIC',
  'cook islands': 'PACIFIC',
  'french polynesia': 'PACIFIC',
  'new caledonia': 'PACIFIC',
  tokelau: 'PACIFIC',
  'solomon islands': 'PACIFIC',
  'papua new guinea': 'PACIFIC',
  micronesia: 'PACIFIC',
  'marshall islands': 'PACIFIC'
};

const BLEND_PROFILES_BY_COUNTRY = {
  usa: ['ANGLO', 'IBERIAN_LATAM', 'SOUTH_ASIA'],
  canada: ['ANGLO', 'SOUTH_ASIA', 'IBERIAN_LATAM'],
  uk: ['ANGLO', 'SOUTH_ASIA', 'CARIBBEAN'],
  australia: ['ANGLO', 'SOUTH_ASIA', 'PACIFIC'],
  'new zealand': ['ANGLO', 'PACIFIC'],
  uae: ['ARABIC', 'SOUTH_ASIA'],
  singapore: ['SOUTH_EAST_ASIA', 'SOUTH_ASIA', 'EAST_ASIA'],
  'south africa': ['AFRICAN', 'ANGLO']
};

const ACADEMY_SUFFIXES = [
  'Youth Cricket Academy',
  'Regional Cricket Institute',
  'High Performance Academy',
  'Cricket Excellence Center'
];

const REGION_LABELS = ['North District', 'Metro Central', 'South Corridor'];

function normalizeCountry(country) {
  const aliased = COUNTRY_ALIASES[String(country || '').trim()] || String(country || '');
  return aliased
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function inferProfileFromKeywords(normalized) {
  if (!normalized) {
    return 'GLOBAL';
  }

  if (normalized.includes('island') || normalized.includes('atoll') || normalized.includes('tonga') || normalized.includes('samoa')) {
    return 'PACIFIC';
  }

  if (normalized.includes('saint ') || normalized.includes('st ')) {
    return 'CARIBBEAN';
  }

  if (normalized.includes('arab') || normalized.includes('emirates')) {
    return 'ARABIC';
  }

  if (normalized.includes('korea') || normalized.includes('china') || normalized.includes('japan')) {
    return 'EAST_ASIA';
  }

  if (normalized.includes('stan')) {
    return 'PERSIAN_CENTRAL';
  }

  return 'GLOBAL';
}

function unique(values) {
  return [...new Set(values)];
}

function buildPoolFromProfiles(profileKeys) {
  const keys = profileKeys.length ? profileKeys : ['GLOBAL'];
  const first = [];
  const last = [];

  for (const key of keys) {
    const profile = getExpandedProfilePool(key);
    first.push(...profile.first);
    last.push(...profile.last);
  }

  return {
    first: unique(first),
    last: unique(last)
  };
}

function getExpandedProfilePool(profileKey) {
  const base = NAME_PROFILES[profileKey] || NAME_PROFILES.GLOBAL;
  const extra = PROFILE_NAME_EXPANSIONS[profileKey] || { first: [], last: [] };

  return {
    first: unique([...base.first, ...extra.first]),
    last: unique([...base.last, ...extra.last])
  };
}

function getProfileKeysForCountry(country) {
  const normalized = normalizeCountry(country);
  const primary = COUNTRY_PROFILE_MAP[normalized] || inferProfileFromKeywords(normalized);
  const blends = BLEND_PROFILES_BY_COUNTRY[normalized] || [];
  const profiles = unique([primary, ...blends].filter(Boolean));
  return profiles.length ? profiles : ['GLOBAL'];
}

function pickProfileKeyForCountry(country) {
  const profiles = getProfileKeysForCountry(country);

  if (profiles.length === 1) {
    return profiles[0];
  }

  // Keep the city/country identity dominant while still allowing multicultural squads.
  const weighted = [
    { value: profiles[0], weight: 72 },
    ...profiles.slice(1).map((profile, index) => ({ value: profile, weight: Math.max(8, 22 - index * 5) }))
  ];

  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = randomInt(1, total);

  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.value;
    }
  }

  return profiles[0];
}

export function getNamePoolForCountry(country) {
  const profiles = getProfileKeysForCountry(country);
  return buildPoolFromProfiles(profiles);
}

export function generateRegionalName(cityName, label) {
  return `${cityName} ${label}`;
}

export function buildAcademyName(cityName) {
  const suffix = ACADEMY_SUFFIXES[Math.abs(cityName.length) % ACADEMY_SUFFIXES.length];
  return `${cityName} ${suffix}`;
}

export function pickPlayerName(country) {
  const profileKey = pickProfileKeyForCountry(country);
  const pool = getExpandedProfilePool(profileKey);
  return {
    firstName: pool.first[randomInt(0, pool.first.length - 1)],
    lastName: pool.last[randomInt(0, pool.last.length - 1)]
  };
}

export function buildNameKey(firstName, lastName) {
  return `${String(firstName || '').trim().toLowerCase()}|${String(lastName || '').trim().toLowerCase()}`;
}

function buildFirstNameKey(firstName) {
  return String(firstName || '').trim().toLowerCase();
}

export function pickUniquePlayerName(country, usedNameKeys = new Set(), options = {}) {
  const pool = getNamePoolForCountry(country);
  const maxCombinations = pool.first.length * pool.last.length;
  const maxAttempts = Math.min(140, Math.max(30, maxCombinations));
  const usedFirstNames = options.usedFirstNames || null;
  const protectFirstNameDiversity = usedFirstNames instanceof Set;

  function tryPick({ avoidUsedFirstName }) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { firstName, lastName } = pickPlayerName(country);
      const key = buildNameKey(firstName, lastName);

      if (usedNameKeys.has(key)) {
        continue;
      }

      const firstKey = buildFirstNameKey(firstName);
      if (avoidUsedFirstName && usedFirstNames?.has(firstKey)) {
        continue;
      }

      usedNameKeys.add(key);
      if (protectFirstNameDiversity) {
        usedFirstNames.add(firstKey);
      }

      return { firstName, lastName };
    }

    return null;
  }

  if (protectFirstNameDiversity) {
    const strict = tryPick({ avoidUsedFirstName: true });
    if (strict) {
      return strict;
    }
  }

  const relaxed = tryPick({ avoidUsedFirstName: false });
  if (relaxed) {
    return relaxed;
  }

  // Fallback if pool combinations are exhausted.
  const fallback = pickPlayerName(country);
  usedNameKeys.add(buildNameKey(fallback.firstName, fallback.lastName));
  if (protectFirstNameDiversity) {
    usedFirstNames.add(buildFirstNameKey(fallback.firstName));
  }
  return fallback;
}

export function getDefaultRegionLabels(cityName) {
  return REGION_LABELS.map((label) => generateRegionalName(cityName, label));
}
