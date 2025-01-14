// on render

Template.desktopRightSidebar.onCreated(function () {
  this.ad = new ReactiveVar(null);

  const cdn = Meteor.settings.public.cdnPath;

  const ads = [
    {
      _id: 'economic-charter',
      body: 'The Canadian Economic Charter of Rights and Responsibilities empowers Canadians to embrace economic growth while balancing social and environmental responsibilities. Together, let us make sustainable and impactful decisions for a brighter, shared future.',
      image: cdn + '/uploads/disk1/economic-charter-rect.jpg',
      url: "https://economiccharter.ca",
    },
    {
      _id: 'guhaway',
      body: 'GUHAWAY offers innovative solutions to redefine sustainable living. From eco-friendly designs to smart, renewable energy systems, we are committed to creating homes that are in harmony with nature. Step into a future that prioritizes both comfort and the environment.',
      image: cdn + '/uploads/disk1/guhaway-rect.jpg',
      url: "https://www.guhahway.com/",
    },
    {
      _id: 'elby-bikes',
      body: 'Elby Bikes brings you the joy of cycling combined with cutting-edge technology. Our electric bikes offer unmatched convenience, comfort, and freedom. Whether commuting to work or exploring scenic trails, Elby Bikes are designed for a smooth and eco-conscious ride.',
      image: cdn + '/uploads/disk1/elby-rect.jpg',
      url: "https://elbymobility.com/",
    },
    {
      _id: 'sarit-mobility',
      body: 'SARIT revolutionizes urban mobility with compact, eco-friendly vehicles designed for modern city living. Experience the perfect blend of convenience, sustainability, and innovation. Join the SARIT movement and redefine how you travel through the urban landscape.',
      image: cdn + '/uploads/disk1/sarit-rect.jpg',
      url: "https://saritmobility.com",
    },
    {
      _id: 'franks-organic-garden',
      body: "Frank's Organic Garden provides fresh, organic produce straight from our farms to your table. Discover the benefits of wholesome, sustainable agriculture. By choosing Frank's, you're supporting local farmers and a healthier lifestyle for yourself and your loved ones.",
      image: cdn + '/uploads/disk1/organic-garden-rect.jpg',
      url: "https://franksorganicgarden.com",
    },
    {
      _id: 'stronach-academy',
      body: 'The Stronach Academy is dedicated to empowering future leaders with innovative education and hands-on learning experiences. Join us to unlock your potential and shape a brighter tomorrow. Together, we can pave the way for transformative growth and success.',
      image: cdn + '/uploads/disk1/academy-rect.jpg',
      url: "https://stronachinternational.com",
    },
  ];

  const randomAd = ads[Math.floor(Math.random() * ads.length)];
  this.ad.set(randomAd);
});

Template.desktopRightSidebar.onRendered(function () {

});

Template.desktopRightSidebar.helpers({
  ad() {
    return Template.instance().ad.get();
  }
});