/* @flow weak */

/**
 * OfflineMobile Android Index
 * Sustainable Solutions (NZ) Ltd. 2016
 */

import React from 'react';
import {
  BackAndroid,
  NavigationExperimental,
  StyleSheet,
  View,
} from 'react-native';

const {
  CardStack: NavigationCardStack,
  Header: NavigationHeader,
  StateUtils: NavigationStateUtils,
} = NavigationExperimental;

const BACK_ACTION = 'BackAction';
const PUSH_ACTION = 'push';
const INITIAL_ACTION = 'initial';
import globalStyles from '../globalStyles';


export class Navigator extends React.Component {

  constructor(props, context) {
    super(props, context);
    this.state = {
      navigationState: getNewNavState(undefined, { type: INITIAL_ACTION }),
    };
    this.renderNavigationBar = this.renderNavigationBar.bind(this);
    this.renderScene = this.renderScene.bind(this);
    this.renderTitleComponent = this.renderTitleComponent.bind(this);
    this.handleNavigation = this.handleNavigation.bind(this);
  }

  componentWillMount() {
    BackAndroid.addEventListener('hardwareBackPress', () =>
      this.handleNavigation({ type: BACK_ACTION })
    );
  }

  componentWillUnmount() {
    BackAndroid.removeEventListener('hardwareBackPress');
  }

  handleNavigation(action) {
    if (!action) {
      return false;
    }
    const newState = getNewNavState(this.state.navigationState, action);
    if (newState === this.state.navigationState) {
      return false;
    }
    this.setState({
      navigationState: newState,
    });
    return true;
  }

  renderNavigationBar(props) {
    return (
      <NavigationHeader
        {...props}
        navigationProps={props}
        renderTitleComponent={this.renderTitleComponent}
        renderRightComponent={this.props.renderRightComponent}
      />
    );
  }

  renderScene(props) {
    return (
      <View style={[styles.navBarOffset, styles.main]}>
        {this.props.renderScene(props)}
      </View>
    );
  }

  renderTitleComponent(props) {
    if (!props.scene.navigationState.title) return null;
    return (
      <NavigationHeader.Title textStyle={globalStyles.appFontFamily}>
        {props.scene.navigationState.title}
      </NavigationHeader.Title>
    );
  }

  render() {
    return (
      <NavigationCardStack
        direction={'horizontal'}
        navigationState={this.state.navigationState}
        onNavigate={this.handleNavigation}
        renderScene={this.renderScene}
        renderOverlay={this.renderNavigationBar}
      />
    );
  }
}

Navigator.propTypes = {
  renderScene: React.PropTypes.func.isRequired,
  renderRightComponent: React.PropTypes.func,
};

const styles = StyleSheet.create({
  main: {
    flex: 1,
  },
  navBarOffset: {
    marginTop: NavigationHeader.HEIGHT,
  },
});

/**
 * Given the current navigation state, and an action to perform, will return the
 * new navigation state. Essentially a navigation reducer.
 * @param  {object} currentState The current navigation state
 * @param  {object} action       A navigation action to perform, with a type and
 *                               optionally a key and title
 * @return {object}              The new navigation state
 */
function getNewNavState(currentState, action) {
  switch (action.type) {
    case INITIAL_ACTION:
      return {
        index: 0,
        key: 'root',
        children: [{ key: 'root' }],
      };
    case PUSH_ACTION:
      return NavigationStateUtils.push(currentState, {
        key: action.key,
        title: action.title,
      });
    case BACK_ACTION:
      return currentState.index > 0 ?
        NavigationStateUtils.pop(currentState) :
        currentState;
    default:
      return currentState;
  }
}
