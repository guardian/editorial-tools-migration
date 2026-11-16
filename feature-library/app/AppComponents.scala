import controllers.Management
import play.api.ApplicationLoader.Context
import play.api.BuiltInComponentsFromContext
import play.api.routing.Router
import play.filters.HttpFiltersComponents
import router.Routes

class AppComponents(context: Context) extends BuiltInComponentsFromContext(context) with HttpFiltersComponents {
  private lazy val management = new Management(controllerComponents)

  override lazy val router: Router = new Routes(httpErrorHandler, management)
}
