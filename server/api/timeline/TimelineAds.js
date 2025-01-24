export default class TimelineAds {
  constructor(self) {
    this.self = self; // Reference to the main Thing instance
  }

  generateAds() {
    // Array of ads
    const ads = [
        {
            _id: 'economic-charter',
            title: null,
            body: 'The Canadian Economic Charter of Rights and Responsibilities empowers Canadians to embrace economic growth while balancing social and environmental responsibilities. Together, let us make sustainable and impactful decisions for a brighter, shared future.',
            chamber: null,
            image: this.self.cdn + '/uploads/disk1/economic-charter-rect.jpg',
            createdAt: Date.now(), // Current timestamp
            author: {
            userName: 'economiccharter',
            avatarUrl: this.self.cdn + '/uploads/disk1/economic-charter-avatar.jpg',
            firstName: null,
            lastName: null,
            },
            ad: true,
            url: "https://economiccharter.ca",
        },
        {
            _id: 'guhaway',
            title: null,
            body: 'GUHAWAY offers innovative solutions to redefine sustainable living. From eco-friendly designs to smart, renewable energy systems, we are committed to creating homes that are in harmony with nature. Step into a future that prioritizes both comfort and the environment.',
            chamber: null,
            image: this.self.cdn + '/uploads/disk1/guhaway-rect.jpg',
            createdAt: Date.now(),
            author: {
            userName: 'guhaway',
            avatarUrl: this.self.cdn + '/uploads/disk1/guhaway-avatar.jpg',
            firstName: null,
            lastName: null,
            },
            ad: true,
            url: "https://www.guhahway.com/",
        },
        {
            _id: 'elby-bikes',
            title: null,
            body: 'Elby Bikes brings you the joy of cycling combined with cutting-edge technology. Our electric bikes offer unmatched convenience, comfort, and freedom. Whether commuting to work or exploring scenic trails, Elby Bikes are designed for a smooth and eco-conscious ride.',
            chamber: null,
            image: this.self.cdn + '/uploads/disk1/elby-rect.jpg',
            createdAt: Date.now(),
            author: {
            userName: 'elbybikes',
            avatarUrl: this.self.cdn + '/uploads/disk1/elby-bikes-avatar.jpg',
            firstName: null,
            lastName: null,
            },
            ad: true,
            url: "https://elbymobility.com/",
        },
        {
            _id: 'sarit-mobility',
            title: null,
            body: 'SARIT revolutionizes urban mobility with compact, eco-friendly vehicles designed for modern city living. Experience the perfect blend of convenience, sustainability, and innovation. Join the SARIT movement and redefine how you travel through the urban landscape.',
            chamber: null,
            image: this.self.cdn + '/uploads/disk1/sarit-rect.jpg',
            createdAt: Date.now(),
            author: {
            userName: 'saritmobility',
            avatarUrl: this.self.cdn + '/uploads/disk1/sarit-mobility-avatar.jpg',
            firstName: null,
            lastName: null,
            },
            ad: true,
            url: "https://saritmobility.com",
        },
        {
            _id: 'franks-organic-garden',
            title: null,
            body: "Frank's Organic Garden provides fresh, organic produce straight from our farms to your table. Discover the benefits of wholesome, sustainable agriculture. By choosing Frank's, you're supporting local farmers and a healthier lifestyle for yourself and your loved ones.",
            chamber: null,
            image: this.self.cdn + '/uploads/disk1/organic-garden-rect.jpg',
            createdAt: Date.now(),
            author: {
            userName: 'organicgarden',
            avatarUrl: this.self.cdn + '/uploads/disk1/organic-garden-avatar.jpg',
            firstName: null,
            lastName: null,
            },
            ad: true,
            url: "https://franksorganicgarden.com",
        },
        {
            _id: 'stronach-academy',
            title: null,
            body: 'The Stronach Academy is dedicated to empowering future leaders with innovative education and hands-on learning experiences. Join us to unlock your potential and shape a brighter tomorrow. Together, we can pave the way for transformative growth and success.',
            chamber: null,
            image: this.self.cdn + '/uploads/disk1/academy-rect.jpg',
            createdAt: Date.now(),
            author: {
            userName: 'stronachacademy',
            avatarUrl: this.self.cdn + '/uploads/disk1/academy-avatar.jpg',
            firstName: null,
            lastName: null,
            },
            ad: true,
            url: "https://stronachacademy.com/",
        },
        ];

        // Select one random ad
        const randomAd = ads[Math.floor(Math.random() * ads.length)];

        // Generate a random position between 1, 2, and 3
        const randomPosition = Math.floor(Math.random() * 3) + 1;

        return {randomAd, randomPosition}
  }
}