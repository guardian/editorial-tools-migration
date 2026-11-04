package controllers

import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents}

class Management(cc: ControllerComponents) extends AbstractController(cc) {
  def healthCheck: Action[AnyContent] = Action {
    Ok("OK")
  }
}
