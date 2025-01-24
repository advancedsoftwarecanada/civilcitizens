export default class TimelineDetectType {
    constructor(self) {
      this.self = self; // Reference to the main Thing instance
    }

    detect(bodyRequest) {

        console.log("=============== DETECTING TIMELINE TYPE ===============");
        console.log(bodyRequest.path);
        console.log(bodyRequest.province);
        console.log(bodyRequest.chamber);
        // { type: 'my_timeline', province: 'ns', chamber: 'halifax-west' }

        let returnType = "none";
        let returnTypeFound = false;

        // HOME
        // If path = "/" and all other parameters are null, or undefined, we are on "home"
        if( bodyRequest.path === "/" && bodyRequest.province == "undefined" && bodyRequest.chamber == "undefined" ) {
          returnType = "home";
          returnTypeFound = true;
        }

        // CHAMBER
        // If we have a province and a chamber length, we are on a chamber
        if( !returnTypeFound && bodyRequest.province.length > 0 && bodyRequest.chamber.length > 0 ) {
          returnType = "chamber";
        }

        // Return the type
        return {
          type: returnType,
        }

    }

}