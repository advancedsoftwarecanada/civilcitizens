export default class TimelineDetectType {
    constructor(self) {
      this.self = self; // Reference to the main Thing instance
    }

    detect(bodyRequest) {

        console.log("=============== DETECTING TIMELINE TYPE ===============");
        console.log("Path:", bodyRequest.path);
        console.log("Province:", bodyRequest.province);
        console.log("Chamber:", bodyRequest.chamber);

        let returnType = "none";

        // HOME TIMELINE
        // If path = "/" and no province/chamber specified, we are on "home"
        if (bodyRequest.path === "/" &&
            (!bodyRequest.province || bodyRequest.province === "undefined" || bodyRequest.province === "") &&
            (!bodyRequest.chamber || bodyRequest.chamber === "undefined" || bodyRequest.chamber === "")) {
            returnType = "home";
        }
        // CHAMBER TIMELINE
        // If we have both province and chamber specified, we are on a chamber
        else if (bodyRequest.province && bodyRequest.province !== "undefined" && bodyRequest.province.length > 0 &&
                 bodyRequest.chamber && bodyRequest.chamber !== "undefined" && bodyRequest.chamber.length > 0) {
            returnType = "chamber";
        }
        // USER TIMELINE
        // If path starts with "/u/" we are viewing a user timeline
        else if (typeof bodyRequest.path === 'string' && bodyRequest.path.indexOf('/u/') === 0) {
            returnType = "user";
        }

        console.log("Detected timeline type:", returnType);

        // Return the type
        return {
            type: returnType,
        }

    }

}